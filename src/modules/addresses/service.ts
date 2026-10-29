import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { Database, serializable } from '../../infrastructure/database';
import { Address } from '../../shared/validation';
import { assert } from '../../shared/errors';
export async function rememberAddress(
  tx: Prisma.TransactionClient,
  userId: string,
  address: Address,
  label = 'Delivery address',
) {
  // Same lock for checkout and address-book mutations; enforces the bounded address book.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`addresses:${userId}`}))`;
  const digest = createHash('sha256')
    .update(
      JSON.stringify(
        Object.entries(address).sort(([a], [b]) => a.localeCompare(b)),
      ),
    )
    .digest('hex');
  const existing = await tx.savedAddress.findUnique({
    where: { userId_digest: { userId, digest } },
  });
  if (existing) return existing;
  const count = await tx.savedAddress.count({ where: { userId } });
  // Checkout remains usable when the address book is full.
  if (count >= 10) return null;
  return tx.savedAddress.create({
    data: { userId, address, digest, label, isDefault: count === 0 },
  });
}
export class AddressService {
  constructor(private readonly db: Database) {}
  list(userId: string) {
    return this.db.savedAddress.findMany({
      where: { userId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    });
  }
  save(userId: string, address: Address, label: string) {
    return serializable(this.db, async (tx) => {
      const result = await rememberAddress(tx, userId, address, label);
      assert(
        result,
        409,
        'ADDRESS_BOOK_FULL',
        'Keep up to 10 addresses. Remove an unused address first.',
      );
      return result;
    });
  }
  async default(userId: string, id: string) {
    return serializable(this.db, async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`addresses:${userId}`}))`;
      assert(
        await tx.savedAddress.findFirst({ where: { id, userId } }),
        404,
        'NOT_FOUND',
        'Address not found',
      );
      await tx.savedAddress.updateMany({
        where: { userId, isDefault: true },
        data: { isDefault: false },
      });
      return tx.savedAddress.update({
        where: { id },
        data: { isDefault: true },
      });
    });
  }
  async remove(userId: string, id: string) {
    return serializable(this.db, async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`addresses:${userId}`}))`;
      const found = await tx.savedAddress.findFirst({ where: { id, userId } });
      assert(found, 404, 'NOT_FOUND', 'Address not found');
      await tx.savedAddress.delete({ where: { id } });
      if (found.isDefault) {
        const next = await tx.savedAddress.findFirst({
          where: { userId },
          orderBy: { createdAt: 'desc' },
        });
        if (next)
          await tx.savedAddress.update({
            where: { id: next.id },
            data: { isDefault: true },
          });
      }
    });
  }
}
