import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { createClient } from 'redis';
import { setTimeout as pause } from 'node:timers/promises';
import pino from 'pino';
import { z } from 'zod';
import { OrderStreamWorker } from '../modules/events/streams';
const settings = z.object({
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  LOG_LEVEL: z
    .enum(['debug', 'info', 'warn', 'error', 'silent'])
    .default('info'),
  WORKER_POLL_INTERVAL_MS: z.coerce
    .number()
    .int()
    .min(100)
    .max(60000)
    .default(5000),
});
async function main() {
  const config = settings.parse(process.env);
  const logger = pino({ level: config.LOG_LEVEL });
  const db = new PrismaClient();
  const redis = createClient({
    url: config.REDIS_URL,
    disableOfflineQueue: true,
    commandsQueueMaxLength: 1000,
    socket: { connectTimeout: 5000 },
  });
  redis.on('error', () => logger.warn('Order worker Redis connection error'));
  await db.$connect();
  await redis.connect();
  let stopping = false;
  const abort = new AbortController();
  const stop = () => {
    stopping = true;
    abort.abort();
    const timer = setTimeout(() => process.exit(1), 10000);
    timer.unref();
  };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  const worker = new OrderStreamWorker(db, redis, undefined, abort.signal);
  logger.info('Order event worker started');
  try {
    while (!stopping) {
      try {
        await worker.tick();
      } catch {
        logger.warn(
          'Order worker dependency unavailable; durable events retained for retry',
        );
      }
      if (!stopping) {
        try {
          await pause(config.WORKER_POLL_INTERVAL_MS, undefined, {
            signal: abort.signal,
          });
        } catch {
          if (!stopping) throw new Error('Worker pause failed');
        }
      }
    }
  } finally {
    await Promise.allSettled([redis.quit(), db.$disconnect()]);
  }
}
main().catch(() => {
  process.stderr.write(
    'Order worker startup failed; verify database and Redis configuration.\n',
  );
  process.exitCode = 1;
});
