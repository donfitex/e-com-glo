import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { Database } from '../../infrastructure/database';
import { AppError } from '../../shared/errors';
const envelope = z
  .object({ version: z.literal(1), orderId: z.string().uuid() })
  .strict();
const types = new Set([
  'OrderCreated',
  'PaymentConfirmed',
  'OrderCancelled',
  'OrderShipped',
  'OrderDelivered',
]);
export class InvalidOrderEvent extends Error {}
export interface OrderEventHandler {
  handle(tx: Prisma.TransactionClient, orderId: string): Promise<void>;
}
export class FulfillmentHandler implements OrderEventHandler {
  async handle(tx: Prisma.TransactionClient, orderId: string) {
    const order = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
    const state =
      order.status === 'CANCELLED'
        ? 'CANCELLED'
        : order.status === 'DELIVERED'
          ? 'DELIVERED'
          : order.status === 'SHIPPED'
            ? 'SHIPPED'
            : order.paymentStatus === 'PAID'
              ? 'READY'
              : 'WAITING_PAYMENT';
    // Always use current database state, so delayed older events cannot regress fulfillment.
    await tx.orderWorkItem.upsert({
      where: { orderId },
      create: { orderId, state },
      update: { state },
    });
  }
}
export class OrderEventProcessor {
  constructor(
    private readonly db: Database,
    private readonly handler: OrderEventHandler = new FulfillmentHandler(),
  ) {}
  async process(id: string) {
    return this.db.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM "OutboxEvent" WHERE id=${id}::uuid FOR UPDATE`;
        const event = await tx.outboxEvent.findUnique({ where: { id } });
        if (!event || event.status === 'PROCESSED' || event.status === 'DEAD')
          return;
        if (event.availableAt > new Date()) return;
        const parsed = envelope.safeParse(event.payload);
        if (
          !parsed.success ||
          parsed.data.orderId !== event.orderId ||
          !types.has(event.type)
        )
          throw new InvalidOrderEvent('Unsupported order event');
        // Serialize handlers for the same order across workers and out-of-order messages.
        await tx.$queryRaw`SELECT id FROM "Order" WHERE id=${event.orderId}::uuid FOR UPDATE`;
        await this.handler.handle(tx, event.orderId);
        await tx.outboxEvent.update({
          where: { id },
          data: {
            status: 'PROCESSED',
            processedAt: new Date(),
            lastError: null,
          },
        });
        await tx.auditEvent.create({
          data: {
            action: 'order.event_processed',
            entityId: id,
            metadata: { orderId: event.orderId, type: event.type },
          },
        });
      },
      { timeout: 10000 },
    );
  }
  async fail(id: string, permanent: boolean) {
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "OutboxEvent" WHERE id=${id}::uuid FOR UPDATE`;
      const event = await tx.outboxEvent.findUnique({ where: { id } });
      if (!event || event.status === 'PROCESSED' || event.status === 'DEAD')
        return;
      const attempts = event.attempts + 1;
      const dead = permanent || attempts >= 5;
      return tx.outboxEvent.update({
        where: { id },
        data: {
          attempts,
          status: dead ? 'DEAD' : 'PENDING',
          availableAt: new Date(Date.now() + retryDelay(attempts)),
          lastPublishedAt: null,
          lastError: permanent ? 'INVALID_EVENT' : 'PROCESSING_FAILED',
        },
      });
    });
  }
  async retry(actorId: string, id: string) {
    return this.db.$transaction(async (tx) => {
      const result = await tx.outboxEvent.updateMany({
        where: { id, status: 'DEAD' },
        data: {
          status: 'PENDING',
          attempts: 0,
          availableAt: new Date(),
          lastPublishedAt: null,
          lastError: null,
        },
      });
      if (!result.count)
        throw new AppError(
          409,
          'EVENT_NOT_RETRYABLE',
          'Only dead-letter events can be retried',
        );
      await tx.auditEvent.create({
        data: { actorId, action: 'order.event_retried', entityId: id },
      });
      return { accepted: true };
    });
  }
}
export function retryDelay(attempt: number) {
  return Math.min(60000, 1000 * 2 ** Math.max(0, attempt - 1));
}
