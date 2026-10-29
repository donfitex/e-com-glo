import { Prisma, PrismaClient } from '@prisma/client';
export interface Database extends Pick<
  PrismaClient,
  | 'user'
  | 'product'
  | 'category'
  | 'cart'
  | 'cartItem'
  | 'order'
  | 'auditEvent'
  | 'outboxEvent'
  | 'orderWorkItem'
  | 'paymentEvent'
  | 'productImage'
  | 'storeContent'
  | '$queryRaw'
> {
  $transaction<T>(
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
    options?: {
      isolationLevel?: Prisma.TransactionIsolationLevel;
      maxWait?: number;
      timeout?: number;
    },
  ): Promise<T>;
}
// Retry only serialization/deadlock failures. Never retry arbitrary writes.
export async function serializable<T>(
  db: Database,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.$transaction(fn, {
        isolationLevel: 'Serializable',
        timeout: 10000,
      });
    } catch (error) {
      if (
        !(error instanceof Prisma.PrismaClientKnownRequestError) ||
        error.code !== 'P2034' ||
        attempt >= 3
      )
        throw error;
      await new Promise((resolve) =>
        setTimeout(resolve, 10 * 2 ** attempt + Math.random() * 20),
      );
    }
  }
}
