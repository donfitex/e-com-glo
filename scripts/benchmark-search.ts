import { PrismaClient } from '@prisma/client';
import { createClient } from 'redis';
import { randomUUID } from 'node:crypto';
import { CatalogCache, Cache } from '../src/infrastructure/cache';
import { PgVectorSearch } from '../src/modules/search/vector-search';
import { productQuery } from '../src/modules/catalog/schemas';
async function main() {
  const url = process.env.BENCHMARK_DATABASE_URL;
  if (!url || !new URL(url).pathname.endsWith('_test'))
    throw new Error('Use an isolated _test vector database');
  const db = new PrismaClient({ datasources: { db: { url } } });
  const redis = createClient({
    url: process.env.BENCHMARK_REDIS_URL ?? 'redis://localhost:6379/13',
    disableOfflineQueue: true,
  });
  redis.on('error', () => {});
  let categoryId: string | undefined;
  try {
    await redis.connect();
    const category = await db.category.create({
      data: { name: 'Benchmark fixtures', slug: `benchmark-${randomUUID()}` },
    });
    categoryId = category.id;
    await db.product.createMany({
      data: Array.from({ length: 100 }, (_, index) => ({
        sku: `${category.id}-${index}`,
        name: `Fixture audio ${index}`,
        description: 'Vector retrieval fixture',
        categoryId: category.id,
        price: 100,
        currency: 'NGN',
        stock: 1,
      })),
    });
    const products = await db.product.findMany({ where: { categoryId } });
    const vector = Array.from({ length: 384 }, (_, index) =>
      index === 0 ? 1 : 0,
    );
    const embeddings = {
      model: 'benchmark-fixture-v1',
      embed: async () => vector,
    };
    for (const product of products)
      await db.$executeRaw`INSERT INTO "ProductEmbedding" ("productId",model,"sourceText",embedding) VALUES (${product.id}::uuid,${embeddings.model},${`${product.name} ${product.description}`},${JSON.stringify(vector)}::vector)`;
    const passthrough: Cache = {
      remember: (_key, _ttl, loader) => loader(),
      invalidate: async () => {},
    };
    const direct = new PgVectorSearch(db, embeddings, passthrough);
    const cached = new PgVectorSearch(db, embeddings, new CatalogCache(redis));
    const query = productQuery.parse({
      q: 'audio fixture',
      categoryId,
      currency: 'NGN',
    });
    const measure = async (operation: () => Promise<unknown>) => {
      const samples = [];
      for (let n = 0; n < 50; n++) {
        const start = performance.now();
        await operation();
        samples.push(performance.now() - start);
      }
      samples.sort((a, b) => a - b);
      return {
        medianMs: Number(samples[25]!.toFixed(3)),
        p95Ms: Number(samples[47]!.toFixed(3)),
      };
    };
    await direct.search(query);
    await cached.search(query);
    process.stdout.write(
      JSON.stringify(
        {
          node: process.version,
          products: 100,
          dimensions: 384,
          samples: 50,
          embeddings:
            'deterministic fixture vectors; excludes model latency and relevance',
          vectorDatabase: await measure(() => direct.search(query)),
          warmRedis: await measure(() => cached.search(query)),
        },
        null,
        2,
      ) + '\n',
    );
  } finally {
    if (categoryId) {
      await db.product.deleteMany({ where: { categoryId } });
      await db.category.delete({ where: { id: categoryId } });
    }
    if (redis.isOpen) await redis.quit();
    await db.$disconnect();
  }
}
main().catch(() => {
  process.stderr.write(
    'Vector benchmark failed; verify the isolated pgvector database and Redis.\n',
  );
  process.exitCode = 1;
});
