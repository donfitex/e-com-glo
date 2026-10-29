import { LocalEmbeddings } from './modules/search/embeddings';
import { PgVectorSearch } from './modules/search/vector-search';
import { PrismaClient } from '@prisma/client';
import { createClient } from 'redis';
import pino from 'pino';
import { loadConfig } from './config';
import { createApp } from './app';
import { CatalogCache } from './infrastructure/cache';
import { RedisRateLimiter } from './infrastructure/rate-limit';
import { JwtTokens, ScryptHasher } from './modules/auth/security';
async function main() {
  const config = loadConfig();
  const logger = pino({ level: config.LOG_LEVEL });
  const db = new PrismaClient();
  const redis = createClient({
    url: config.REDIS_URL,
    disableOfflineQueue: true,
    socket: { connectTimeout: 5000 },
  });
  redis.on('error', () => logger.warn('Redis connection error'));
  await db.$connect();
  await redis.connect();
  const app = createApp(config, {
    db,
    semantic: config.SEMANTIC_SEARCH_URL
      ? new PgVectorSearch(
          db,
          new LocalEmbeddings(config.SEMANTIC_SEARCH_URL),
          new CatalogCache(redis),
        )
      : undefined,
    cache: new CatalogCache(redis),
    limiter: new RedisRateLimiter(redis),
    tokens: new JwtTokens(config.JWT_SECRET),
    passwords: new ScryptHasher(),
    logger,
    ready: async () => {
      await Promise.all([db.$queryRaw`SELECT 1`, redis.ping()]);
    },
  });
  const server = app.listen(config.PORT, () =>
    logger.info({ port: config.PORT }, 'E-com Global listening'),
  );
  let stopping = false;
  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    const timer = setTimeout(() => process.exit(1), 10000);
    timer.unref();
    server.close(() => {
      Promise.all([db.$disconnect(), redis.quit()])
        .then(() => {
          clearTimeout(timer);
          process.exit(0);
        })
        .catch(() => process.exit(1));
    });
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
main().catch(() => {
  process.stderr.write(
    'Startup failed: verify configuration and database/Redis connectivity.\n',
  );
  process.exit(1);
});
