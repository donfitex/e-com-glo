import { ProductIndexer } from '../src/modules/search/indexer';
import { PrismaClient } from '@prisma/client';
import { PgVectorSearch } from '../src/modules/search/vector-search';
import { productQuery } from '../src/modules/catalog/schemas';
import { Cache } from '../src/infrastructure/cache';
const url = process.env.TEST_VECTOR_URL;
const suite = url ? describe : describe.skip;
suite('optional pgvector search integration', () => {
  if (url && !new URL(url).pathname.endsWith('_test'))
    throw new Error('Vector tests require an isolated _test database');
  const db = new PrismaClient({
    datasources: { db: { url: url ?? 'postgresql://localhost/ecom_test' } },
  });
  const cache: Cache = {
    remember: (_key, _ttl, loader) => loader(),
    invalidate: async () => {},
  };
  const vector = Array.from({ length: 384 }, (_, i) => (i === 0 ? 1 : 0));
  const embeddings = {
    model: 'sentence-transformers/all-MiniLM-L6-v2',
    embed: async () => vector,
  };
  const search = new PgVectorSearch(db, embeddings, cache);
  let categoryId: string, productId: string;
  beforeAll(async () => {
    const category = await db.category.create({
      data: { name: 'Vector Test', slug: `vector-${Date.now()}` },
    });
    categoryId = category.id;
    const product = await db.product.create({
      data: {
        sku: `VECTOR-${Date.now()}`,
        name: 'Running Headphones',
        description: 'Wireless sports audio',
        price: 2000,
        currency: 'USD',
        stock: 4,
        categoryId,
      },
    });
    productId = product.id;
    await db.$executeRaw`INSERT INTO "ProductEmbedding" ("productId", model, "sourceText", embedding) VALUES (${productId}::uuid, ${embeddings.model}, ${`${product.name} ${product.description}`}, ${JSON.stringify(vector)}::vector)`;
  });
  afterAll(async () => {
    if (productId) await db.product.delete({ where: { id: productId } });
    if (categoryId) await db.category.delete({ where: { id: categoryId } });
    await db.$disconnect();
  });
  test('cosine search binds filters and retrieves ranked products', async () => {
    const query = productQuery.parse({
      q: 'audio for exercise',
      categoryId,
      currency: 'USD',
      minPrice: 100,
      maxPrice: 3000,
      available: 'true',
    });
    const result = await search.search(query);
    expect(result.total).toBe(1);
    expect(result.items[0]?.id).toBe(productId);
    expect((await search.search({ ...query, currency: 'EUR' })).total).toBe(0);
  });
  test('incremental indexing skips unchanged records, reindexes edits and invalidates result caches', async () => {
    const embed = jest.fn(async () => vector);
    const invalidate = jest.fn(async () => {});
    const indexer = new ProductIndexer(
      db,
      { model: embeddings.model, embed },
      { ...cache, invalidate },
    );
    const first = await indexer.batch(undefined, 50, [productId]);
    expect(first.skipped).toBeGreaterThanOrEqual(1);
    expect(embed).not.toHaveBeenCalled();
    await db.product.update({
      where: { id: productId },
      data: { description: 'Updated sports audio' },
    });
    expect((await indexer.batch(undefined, 50, [productId])).indexed).toBe(1);
    expect(embed).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledTimes(1);
    const rows = await db.$queryRaw<
      { sourceText: string }[]
    >`SELECT "sourceText" FROM "ProductEmbedding" WHERE "productId"=${productId}::uuid`;
    expect(rows[0]?.sourceText).toContain('Updated sports audio');
    await db.product.update({
      where: { id: productId },
      data: { description: 'Another change' },
    });
    expect(
      (
        await new ProductIndexer(
          db,
          {
            model: embeddings.model,
            embed: async () => {
              throw new Error('provider unavailable');
            },
          },
          cache,
        ).batch(undefined, 50, [productId])
      ).failed,
    ).toBe(1);
  });
  test('changed source text excludes stale vectors', async () => {
    await db.product.update({
      where: { id: productId },
      data: { description: 'New product text' },
    });
    expect(
      (await search.search(productQuery.parse({ q: 'exercise', categoryId })))
        .total,
    ).toBe(0);
  });
});
