import { StripeGateway } from './modules/payments/gateway';
import { PaymentService } from './modules/payments/service';
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
  const paymentGateway =
    config.STRIPE_SECRET_KEY && config.STRIPE_WEBHOOK_SECRET
      ? new StripeGateway(
          config.STRIPE_SECRET_KEY,
          config.STRIPE_WEBHOOK_SECRET,
          config.STOREFRONT_ORIGIN,
        )
      : undefined;
  const paymentService = new PaymentService(
    db,
    new CatalogCache(redis),
    paymentGateway,
  );
  let expiring = false;
  const expiryTimer = setInterval(() => {
    if (expiring) return;
    expiring = true;
    void paymentService
      .expireUnpaid()
      .catch(() => logger.error('Reservation expiration failed'))
      .finally(() => {
        expiring = false;
      });
  }, 60000);
  expiryTimer.unref();
  const app = createApp(config, {
    paymentGateway,
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
    clearInterval(expiryTimer);
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
