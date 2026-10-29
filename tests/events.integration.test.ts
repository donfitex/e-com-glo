import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { createClient } from 'redis';
import {
  OrderEventProcessor,
  FulfillmentHandler,
  retryDelay,
} from '../src/modules/events/processor';
import {
  OrderStreamWorker,
  orderStream,
  orderGroup,
  deadStream,
} from '../src/modules/events/streams';
import { recordOrderEvent } from '../src/modules/events/outbox';
const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
suite(
  'durable order event processing with PostgreSQL and Redis Streams',
  () => {
    if (url && !new URL(url).pathname.endsWith('_test'))
      throw new Error('Use an isolated _test database');
    const db = new PrismaClient({
      datasources: {
        db: { url: url ?? 'postgresql://unused:unused@localhost/unused_test' },
      },
    });
    const redis = createClient({
      url: process.env.TEST_REDIS_URL ?? 'redis://localhost:6379/15',
      disableOfflineQueue: true,
    });
    let orderId: string;
    let actorId: string;
    beforeAll(async () => {
      redis.on('error', () => {});
      await redis.connect();
      await db.$connect();
    });
    beforeEach(async () => {
      await redis.flushDb();
      await db.order.deleteMany();
      const user = await db.user.create({
        data: {
          email: `events-${randomUUID()}@example.com`,
          name: 'Event test',
          passwordHash: 'unused',
          role: 'ADMIN',
        },
      });
      actorId = user.id;
      const order = await db.order.create({
        data: {
          userId: user.id,
          idempotencyKey: randomUUID(),
          total: 10000,
          subtotal: 10000,
          currency: 'NGN',
          shippingAddress: {},
        },
      });
      orderId = order.id;
    });
    afterAll(async () => {
      await redis.quit();
      await db.$disconnect();
    });
    async function event() {
      return db.outboxEvent.create({
        data: {
          orderId,
          type: 'OrderCreated',
          payload: { version: 1, orderId },
        },
      });
    }
    test('transaction rollback cannot publish an OrderCreated event', async () => {
      await expect(
        db.$transaction(async (tx) => {
          await recordOrderEvent(tx, orderId, 'OrderCreated');
          throw new Error('rollback');
        }),
      ).rejects.toThrow('rollback');
      expect(await db.outboxEvent.count({ where: { orderId } })).toBe(0);
    });
    test('concurrent workers acknowledge after commit and duplicate delivery has one side effect', async () => {
      const saved = await event();
      const first = new OrderStreamWorker(db, redis);
      const second = new OrderStreamWorker(db, redis);
      await Promise.all([first.tick(), second.tick()]);
      expect(
        (await db.outboxEvent.findUniqueOrThrow({ where: { id: saved.id } }))
          .status,
      ).toBe('PROCESSED');
      expect(
        (await db.orderWorkItem.findUniqueOrThrow({ where: { orderId } }))
          .state,
      ).toBe('WAITING_PAYMENT');
      await redis.xAdd(orderStream, '*', { eventId: saved.id });
      await second.tick();
      expect(
        await db.auditEvent.count({
          where: { entityId: saved.id, action: 'order.event_processed' },
        }),
      ).toBe(1);
      expect((await redis.xPending(orderStream, orderGroup)).pending).toBe(0);
    });
    test('transient failures roll back effects and use bounded exponential retry scheduling', async () => {
      const saved = await event();
      let failures = 0;
      const handler = {
        handle: async (...args: Parameters<FulfillmentHandler['handle']>) => {
          if (failures++ < 2) throw new Error('transient-private-details');
          await new FulfillmentHandler().handle(...args);
        },
      };
      const worker = new OrderStreamWorker(
        db,
        redis,
        new OrderEventProcessor(db, handler),
      );
      for (let attempt = 1; attempt <= 2; attempt++) {
        const before = Date.now();
        await worker.tick();
        const pending = await db.outboxEvent.findUniqueOrThrow({
          where: { id: saved.id },
        });
        expect(pending.status).toBe('PENDING');
        expect(pending.attempts).toBe(attempt);
        expect(pending.availableAt.getTime()).toBeGreaterThanOrEqual(
          before + retryDelay(attempt),
        );
        expect(pending.lastError).toBe('PROCESSING_FAILED');
        expect(await db.orderWorkItem.count({ where: { orderId } })).toBe(0);
        await db.outboxEvent.update({
          where: { id: saved.id },
          data: { availableAt: new Date(0) },
        });
      }
      await worker.tick();
      expect(
        (await db.outboxEvent.findUniqueOrThrow({ where: { id: saved.id } }))
          .status,
      ).toBe('PROCESSED');
      expect([1, 2, 3, 4, 5].map(retryDelay)).toEqual([
        1000, 2000, 4000, 8000, 16000,
      ]);
    });
    test('exhausted events remain in a durable dead-letter ledger and can be redriven', async () => {
      const saved = await event();
      const processor = new OrderEventProcessor(db, {
        handle: async () => {
          throw new Error('persistent');
        },
      });
      const worker = new OrderStreamWorker(db, redis, processor);
      for (let attempt = 0; attempt < 5; attempt++) {
        await worker.tick();
        await db.outboxEvent.update({
          where: { id: saved.id },
          data: { availableAt: new Date(0) },
        });
      }
      expect(
        (await db.outboxEvent.findUniqueOrThrow({ where: { id: saved.id } }))
          .status,
      ).toBe('DEAD');
      await worker.publish();
      expect(await redis.xLen(deadStream)).toBe(1);
      await processor.retry(actorId, saved.id);
      await new OrderStreamWorker(db, redis).tick();
      expect(
        (await db.outboxEvent.findUniqueOrThrow({ where: { id: saved.id } }))
          .status,
      ).toBe('PROCESSED');
    });
    test('unsupported payloads go directly to the durable dead-letter path', async () => {
      const saved = await db.outboxEvent.create({
        data: { orderId, type: 'UnknownEvent', payload: { version: 99 } },
      });
      await new OrderStreamWorker(db, redis).tick();
      expect(
        await db.outboxEvent.findUnique({ where: { id: saved.id } }),
      ).toMatchObject({
        status: 'DEAD',
        attempts: 1,
        lastError: 'INVALID_EVENT',
      });
    });
    test('a crashed consumer pending entry is reclaimed without losing the event', async () => {
      const saved = await event();
      const worker = new OrderStreamWorker(db, redis);
      await worker.initialize();
      await worker.publish();
      const delivered = await redis.xReadGroup(
        orderGroup,
        'crashed',
        { key: orderStream, id: '>' },
        { COUNT: 1 },
      );
      const entry = delivered![0]!.messages[0]!;
      await redis.sendCommand([
        'XCLAIM',
        orderStream,
        orderGroup,
        'crashed',
        '0',
        entry.id,
        'IDLE',
        '31000',
      ]);
      await worker.tick();
      expect(
        (await db.outboxEvent.findUniqueOrThrow({ where: { id: saved.id } }))
          .status,
      ).toBe('PROCESSED');
    });
    test('malformed broker envelopes are dead-lettered and acknowledged safely', async () => {
      const worker = new OrderStreamWorker(db, redis);
      await worker.initialize();
      await redis.xAdd(orderStream, '*', {
        eventId: '------------------------------------',
      });
      await worker.tick();
      expect(await redis.xLen(deadStream)).toBe(1);
      expect((await redis.xPending(orderStream, orderGroup)).pending).toBe(0);
    });
    test('unprocessed events are republished from PostgreSQL after broker data loss', async () => {
      const saved = await event();
      const worker = new OrderStreamWorker(db, redis);
      await worker.initialize();
      await worker.publish();
      await redis.del(orderStream);
      await db.outboxEvent.update({
        where: { id: saved.id },
        data: { lastPublishedAt: new Date(Date.now() - 61000) },
      });
      await worker.tick();
      expect(
        (await db.outboxEvent.findUniqueOrThrow({ where: { id: saved.id } }))
          .status,
      ).toBe('PROCESSED');
    });
  },
);
