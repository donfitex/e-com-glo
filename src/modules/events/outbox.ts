import { Prisma } from '@prisma/client';
export type OrderEventType =
  | 'OrderCreated'
  | 'PaymentConfirmed'
  | 'OrderCancelled'
  | 'OrderShipped'
  | 'OrderDelivered';
export async function recordOrderEvent(
  tx: Prisma.TransactionClient,
  orderId: string,
  type: OrderEventType,
) {
  await tx.outboxEvent.create({
    data: { orderId, type, payload: { version: 1, orderId } },
  });
}
