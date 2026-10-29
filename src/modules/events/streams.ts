import { id as eventId } from '../../shared/validation';
import { randomUUID } from 'node:crypto';
import { Database } from '../../infrastructure/database';
import { Redis } from '../../infrastructure/cache';
import { deadline } from '../../shared/deadline';
import { InvalidOrderEvent, OrderEventProcessor } from './processor';
export const orderStream = 'ecom:order-events:v1';
export const deadStream = 'ecom:order-events:dead:v1';
export const orderGroup = 'ecom:fulfillment:v1';
export class OrderStreamWorker {
  readonly consumer = randomUUID();
  constructor(
    private readonly db: Database,
    private readonly redis: Redis,
    private readonly processor = new OrderEventProcessor(db),
    private readonly signal?: AbortSignal,
  ) {}
  async initialize() {
    try {
      await deadline(
        this.redis.xGroupCreate(orderStream, orderGroup, '0', {
          MKSTREAM: true,
        }),
      );
    } catch (error) {
      if (!(error instanceof Error && error.message.includes('BUSYGROUP')))
        throw error;
    }
  }
  async publish() {
    const events = await this.db.outboxEvent.findMany({
      where: {
        status: { in: ['PENDING', 'PUBLISHED'] },
        availableAt: { lte: new Date() },
        OR: [
          { lastPublishedAt: null },
          { lastPublishedAt: { lte: new Date(Date.now() - 60000) } },
        ],
      },
      orderBy: { createdAt: 'asc' },
      take: 50,
    });
    for (const event of events) {
      if (this.signal?.aborted) return;
      await deadline(this.redis.xAdd(orderStream, '*', { eventId: event.id }));
      await this.db.outboxEvent.updateMany({
        where: { id: event.id, status: { in: ['PENDING', 'PUBLISHED'] } },
        data: { status: 'PUBLISHED', lastPublishedAt: new Date() },
      });
    }
    const dead = await this.db.outboxEvent.findMany({
      where: { status: 'DEAD', lastPublishedAt: null },
      take: 20,
    });
    for (const event of dead) {
      await deadline(
        this.redis.xAdd(
          deadStream,
          '*',
          { eventId: event.id, reason: event.lastError ?? 'PROCESSING_FAILED' },
          {
            TRIM: {
              strategy: 'MAXLEN',
              strategyModifier: '~',
              threshold: 1000,
            },
          },
        ),
      );
      await this.db.outboxEvent.updateMany({
        where: { id: event.id, status: 'DEAD', lastPublishedAt: null },
        data: { lastPublishedAt: new Date() },
      });
    }
  }
  private async consume(
    entries: ({ id: string; message: Record<string, string> } | null)[],
  ) {
    for (const entry of entries) {
      if (this.signal?.aborted) return;
      if (!entry) continue;
      const id = entry.message.eventId;
      if (id && eventId.safeParse(id).success) {
        try {
          await this.processor.process(id);
        } catch (error) {
          await this.processor.fail(id, error instanceof InvalidOrderEvent);
        }
      } else {
        await deadline(
          this.redis.xAdd(
            deadStream,
            '*',
            { reason: 'INVALID_ENVELOPE' },
            {
              TRIM: {
                strategy: 'MAXLEN',
                strategyModifier: '~',
                threshold: 1000,
              },
            },
          ),
        );
      }
      // Acknowledge only after the database committed success or a durable retry/dead-letter state.
      await deadline(this.redis.xAck(orderStream, orderGroup, entry.id));
      await deadline(this.redis.xDel(orderStream, entry.id));
    }
  }
  async tick() {
    await this.initialize();
    await this.publish();
    const claimed = await deadline(
      this.redis.xAutoClaim(
        orderStream,
        orderGroup,
        this.consumer,
        30000,
        '0-0',
        { COUNT: 20 },
      ),
    );
    await this.consume(claimed.messages);
    const streams = await deadline(
      this.redis.xReadGroup(
        orderGroup,
        this.consumer,
        { key: orderStream, id: '>' },
        { COUNT: 20 },
      ),
    );
    for (const stream of streams ?? []) await this.consume(stream.messages);
    await deadline(
      this.redis.set('ecom:worker:heartbeat', new Date().toISOString(), {
        EX: 60,
      }),
    );
  }
}
