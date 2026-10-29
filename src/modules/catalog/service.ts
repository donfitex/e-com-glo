import { z } from 'zod';
import { Database } from '../../infrastructure/database';
import { Cache } from '../../infrastructure/cache';
import { assert } from '../../shared/errors';
import { CatalogReader } from './repository';
import { ProductQuery, productInput, categoryInput } from './schemas';
export class CatalogService {
  constructor(
    private readonly reader: CatalogReader,
    private readonly db: Database,
    private readonly cache: Cache,
  ) {}
  async adminList(page: number, limit: number) {
    const [items, total] = await Promise.all([
      this.db.product.findMany({
        include: { category: true },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.db.product.count(),
    ]);
    return { items, total, page, limit };
  }
  list(query: ProductQuery) {
    return this.cache.remember(`list:${JSON.stringify(query)}`, 30, () =>
      this.reader.list(query),
    );
  }
  async detail(id: string) {
    const item = await this.cache.remember(`product:${id}`, 30, () =>
      this.reader.detail(id),
    );
    assert(item, 404, 'NOT_FOUND', 'Product not found');
    return item;
  }
  categories() {
    return this.cache.remember('categories', 30, () =>
      this.reader.categories(),
    );
  }
  async saveCategory(
    actorId: string,
    data: z.infer<typeof categoryInput>,
    id?: string,
  ) {
    const result = await this.db.$transaction(async (tx) => {
      const item = id
        ? await tx.category.update({ where: { id }, data })
        : await tx.category.create({ data });
      await tx.auditEvent.create({
        data: {
          actorId,
          action: id ? 'category.updated' : 'category.created',
          entityId: item.id,
        },
      });
      return item;
    });
    await this.cache.invalidate();
    return result;
  }
  async deleteCategory(actorId: string, id: string) {
    await this.db.$transaction(async (tx) => {
      await tx.category.delete({ where: { id } });
      await tx.auditEvent.create({
        data: { actorId, action: 'category.deleted', entityId: id },
      });
    });
    await this.cache.invalidate();
  }
  async saveProduct(
    actorId: string,
    data: z.infer<typeof productInput> | Partial<z.infer<typeof productInput>>,
    id?: string,
  ) {
    const result = await this.db.$transaction(async (tx) => {
      // Currency changes would silently re-denominate existing carts. Require a new SKU instead.
      if (id && data.currency) {
        const current = await tx.product.findUnique({ where: { id } });
        assert(current, 404, 'NOT_FOUND', 'Product not found');
        assert(
          current.currency === data.currency,
          409,
          'CURRENCY_IMMUTABLE',
          'Create a new product to change currency',
        );
      }
      const item = id
        ? await tx.product.update({ where: { id }, data })
        : await tx.product.create({
            data: data as z.infer<typeof productInput>,
          });
      await tx.auditEvent.create({
        data: {
          actorId,
          action: id ? 'product.updated' : 'product.created',
          entityId: item.id,
        },
      });
      return item;
    });
    await this.cache.invalidate();
    return result;
  }
}
