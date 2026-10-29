import { PrismaClient } from '@prisma/client';
import { createClient } from 'redis';
import { CatalogCache } from '../src/infrastructure/cache';
import { CatalogRepository } from '../src/modules/catalog/repository';
import { productQuery } from '../src/modules/catalog/schemas';
import { platform } from 'node:os';
async function main() {
  const url = process.env.BENCHMARK_DATABASE_URL;
  if (!url || !new URL(url).pathname.endsWith('_test'))
    throw new Error('Use an isolated BENCHMARK_DATABASE_URL ending in _test');
  const db = new PrismaClient({ datasources: { db: { url } } });
  const redis = createClient({
    url: process.env.BENCHMARK_REDIS_URL ?? 'redis://localhost:6379/13',
    disableOfflineQueue: true,
  });
  redis.on('error', () => {});
  try {
    await redis.connect();
    const repository = new CatalogRepository(db);
    const load = () => repository.list(productQuery.parse({ limit: 20 }));
    const cache = new CatalogCache(redis);
    const key = `benchmark:${Date.now()}`;
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
    await load();
    await cache.remember(key, 60, load);
    process.stdout.write(
      JSON.stringify(
        {
          node: process.version,
          platform: platform(),
          products: await db.product.count(),
          samples: 50,
          directDatabase: await measure(load),
          warmRedis: await measure(() => cache.remember(key, 60, load)),
          cache: cache.getStats(),
        },
        null,
        2,
      ) + '\n',
    );
  } finally {
    if (redis.isOpen) await redis.quit();
    await db.$disconnect();
  }
}
main().catch(() => {
  process.stderr.write(
    'Benchmark failed; verify isolated database and Redis settings.\n',
  );
  process.exitCode = 1;
});
