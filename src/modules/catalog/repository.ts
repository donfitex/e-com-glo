import { Prisma } from '@prisma/client';
import { Database } from '../../infrastructure/database';
import { ProductQuery } from './schemas';
export class CatalogRepository {
  constructor(private readonly db: Database) {}
  async list(query: ProductQuery) {
    const where: Prisma.ProductWhereInput = {
      active: true,
      categoryId: query.categoryId,
      currency: query.currency,
      price: { gte: query.minPrice, lte: query.maxPrice },
      ...(query.available === 'true'
        ? { stock: { gt: 0 } }
        : query.available === 'false'
          ? { stock: 0 }
          : {}),
      ...(query.q
        ? {
            OR: [
              { name: { contains: query.q, mode: 'insensitive' } },
              { description: { contains: query.q, mode: 'insensitive' } },
              { sku: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const sort: Prisma.ProductOrderByWithRelationInput =
      query.sort === 'price_asc'
        ? { price: 'asc' }
        : query.sort === 'price_desc'
          ? { price: 'desc' }
          : query.sort === 'name'
            ? { name: 'asc' }
            : { createdAt: 'desc' };
    return this.db.$transaction(
      async (tx) => {
        const [items, total] = await Promise.all([
          tx.product.findMany({
            where,
            include: { category: true },
            orderBy: [sort, { id: 'asc' }],
            skip: (query.page - 1) * query.limit,
            take: query.limit,
          }),
          tx.product.count({ where }),
        ]);
        return { items, total, page: query.page, limit: query.limit };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
  detail(id: string) {
    return this.db.product.findFirst({
      where: { id, active: true },
      include: { category: true },
    });
  }
  categories() {
    return this.db.category.findMany({ orderBy: { slug: 'asc' } });
  }
}
export type CatalogReader = Pick<
  CatalogRepository,
  'list' | 'detail' | 'categories'
>;
