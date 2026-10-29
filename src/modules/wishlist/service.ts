import { Database, serializable } from '../../infrastructure/database';
import { assert } from '../../shared/errors';
export class WishlistService {
  constructor(private readonly db: Database) {}
  async ids(userId: string) {
    const saved = await this.db.wishlistItem.findMany({
      where: { userId },
      select: { productId: true },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return saved.map((item) => item.productId);
  }
  async list(userId: string, page: number, limit: number) {
    const [saved, total] = await Promise.all([
      this.db.wishlistItem.findMany({
        where: { userId },
        include: { product: { include: { category: true } } },
        orderBy: [{ createdAt: 'desc' }, { productId: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.db.wishlistItem.count({ where: { userId } }),
    ]);
    return {
      items: saved.map((item) => ({
        productId: item.productId,
        createdAt: item.createdAt,
        product: item.product.active ? item.product : null,
      })),
      total,
      page,
      limit,
    };
  }
  async save(userId: string, productId: string) {
    await serializable(this.db, async (tx) => {
      const existing = await tx.wishlistItem.findUnique({
        where: { userId_productId: { userId, productId } },
      });
      if (existing) return;
      const product = await tx.product.findFirst({
        where: { id: productId, active: true },
        select: { id: true },
      });
      assert(product, 404, 'NOT_FOUND', 'Product not found');
      assert(
        (await tx.wishlistItem.count({ where: { userId } })) < 200,
        409,
        'WISHLIST_FULL',
        'You can save up to 200 products. Remove an item first.',
      );
      await tx.wishlistItem.upsert({
        where: { userId_productId: { userId, productId } },
        create: { userId, productId },
        update: {},
      });
    });
    return { saved: true };
  }
  async remove(userId: string, productId: string) {
    await this.db.wishlistItem.deleteMany({ where: { userId, productId } });
  }
}
