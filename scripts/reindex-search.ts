import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { createClient } from 'redis';
import { LocalEmbeddings } from '../src/modules/search/embeddings';
import { ProductIndexer } from '../src/modules/search/indexer';
import { CatalogCache } from '../src/infrastructure/cache';
const db = new PrismaClient();
async function main() {
  if (!process.env.SEMANTIC_SEARCH_URL || !process.env.REDIS_URL)
    throw new Error('Configure the model and Redis endpoints');
  const redis = createClient({
    url: process.env.REDIS_URL,
    disableOfflineQueue: true,
  });
  redis.on('error', () => {});
  try {
    await redis.connect();
    const indexer = new ProductIndexer(
      db,
      new LocalEmbeddings(process.env.SEMANTIC_SEARCH_URL),
      new CatalogCache(redis),
    );
    let cursor: string | undefined;
    const totals = { indexed: 0, skipped: 0, failed: 0 };
    for (;;) {
      const batch = await indexer.batch(cursor);
      totals.indexed += batch.indexed;
      totals.skipped += batch.skipped;
      totals.failed += batch.failed;
      if (!batch.cursor) break;
      cursor = batch.cursor;
    }
    await indexer.removeInactive();
    process.stdout.write(JSON.stringify(totals) + '\n');
    if (totals.failed) process.exitCode = 1;
  } finally {
    if (redis.isOpen) await redis.quit();
  }
}
main()
  .catch(() => {
    process.stderr.write(
      'Search indexing failed; check pgvector, Redis and the local model service.\n',
    );
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
