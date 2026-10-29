import { contentRouter } from './modules/content/http';
import { openapi } from './http/openapi';
import { deadline } from './shared/deadline';
import { getHeapStatistics } from 'node:v8';
import { OrderEventProcessor } from './modules/events/processor';
import { ProductImages } from './modules/media/service';
import { mediaRouter } from './modules/media/http';
import { CheckoutPolicy } from './modules/checkout/policy';
import { PaymentService } from './modules/payments/service';
import { PaymentGateway } from './modules/payments/gateway';
import { id } from './shared/validation';
import { z } from 'zod';
import express, { ErrorRequestHandler } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';
import { Logger } from 'pino';
import { Config } from './config';
import { Database } from './infrastructure/database';
import { Cache } from './infrastructure/cache';
import { RateLimiter, rateLimit } from './infrastructure/rate-limit';
import { AuthService } from './modules/auth/service';
import { Tokens, PasswordHasher } from './modules/auth/security';
import { authRouter, authenticate, admin } from './modules/auth/http';
import { CatalogRepository } from './modules/catalog/repository';
import { CatalogService } from './modules/catalog/service';
import { catalogRouter } from './modules/catalog/http';
import { PricingService } from './modules/cart/pricing';
import { CartService } from './modules/cart/service';
import { cartRouter } from './modules/cart/http';
import { OrderService } from './modules/orders/service';
import { orderRouter } from './modules/orders/http';
import { productQuery } from './modules/catalog/schemas';
import { endpoint } from './shared/http';
import { AppError } from './shared/errors';
import { SearchService, SemanticSearch } from './modules/search/service';
export interface Dependencies {
  paymentGateway?: PaymentGateway;
  semantic?: SemanticSearch;
  db: Database;
  cache: Cache;
  limiter: RateLimiter;
  passwords: PasswordHasher;
  tokens: Tokens;
  logger: Logger;
  ready: () => Promise<void>;
  workerHeartbeat?: () => Promise<string | null>;
}
export function createApp(config: Config, deps: Dependencies) {
  const app = express();
  app.disable('x-powered-by');
  // Keep trust proxy disabled unless deployment supplies a reviewed proxy topology.
  app.use((req, res, next) => {
    res.locals.requestId = randomUUID();
    res.setHeader('X-Request-ID', res.locals.requestId);
    const start = performance.now();
    res.on('finish', () =>
      deps.logger.info(
        {
          requestId: res.locals.requestId,
          timestamp: new Date().toISOString(),
          method: req.method,
          path: req.path,
          status: res.statusCode,
          durationMs: Math.round(performance.now() - start),
        },
        'request',
      ),
    );
    next();
  });
  app.use(helmet());
  app.use(
    cors({ origin: config.CORS_ORIGINS.split(',').map((x) => x.trim()) }),
  );
  const payments = new PaymentService(deps.db, deps.cache, deps.paymentGateway);
  app.post(
    '/api/v1/payments/paystack/webhook',
    express.raw({ type: 'application/json', limit: '64kb' }),
    endpoint(async (req, res) => {
      const signature = z.string().parse(req.headers['x-paystack-signature']);
      await payments.webhook(req.body as Buffer, signature);
      res.json({ received: true });
    }),
  );
  app.use(
    '/api/v1',
    mediaRouter(
      new ProductImages(deps.db),
      authenticate(deps.tokens),
      rateLimit(deps.limiter, 'image-upload', 20),
    ),
  );
  app.use(express.json({ limit: '64kb' }));
  app.get('/health', (_req, res) =>
    res.json({ status: 'ok', service: 'E-com Global' }),
  );
  app.get(
    '/ready',
    endpoint(async (_req, res) => {
      try {
        await deadline(deps.ready(), 3000);
        res.json({ status: 'ready' });
      } catch {
        res.status(503).json({ status: 'unavailable' });
      }
    }),
  );
  app.use(
    '/api/v1',
    rateLimit(deps.limiter, 'api', config.API_RATE_LIMIT_PER_MINUTE),
  );
  const guard = authenticate(deps.tokens);
  const pricing = new PricingService();
  const catalog = new CatalogService(
    new CatalogRepository(deps.db),
    deps.db,
    deps.cache,
    config.CACHE_TTL_SECONDS,
  );
  app.use(
    '/api/v1/auth',
    authRouter(
      new AuthService(deps.db, deps.passwords, deps.tokens),
      guard,
      rateLimit(deps.limiter, 'auth', 10),
      rateLimit(deps.limiter, 'auth-login', 5, 900, (req) =>
        typeof req.body?.email === 'string'
          ? req.body.email.trim().toLowerCase().slice(0, 254)
          : (req.ip ?? 'unknown'),
      ),
    ),
  );
  app.get('/api/v1/checkout/options', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      data: {
        destinations: config.CHECKOUT_RULES_JSON.map(
          ({ country, currency }) => ({ country, currency }),
        ),
        paymentCurrencies: deps.paymentGateway
          ? config.PAYSTACK_CURRENCIES
          : null,
      },
    });
  });
  app.get(
    '/api/v1/admin/events',
    guard,
    admin,
    endpoint(async (_req, res) => {
      res.json({
        data: await deps.db.outboxEvent.findMany({
          where: { status: 'DEAD' },
          select: {
            id: true,
            orderId: true,
            type: true,
            attempts: true,
            lastError: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
          take: 50,
        }),
      });
    }),
  );
  app.post(
    '/api/v1/admin/events/:id/retry',
    guard,
    admin,
    endpoint(async (req, res) => {
      res.status(202).json({
        data: await new OrderEventProcessor(deps.db).retry(
          res.locals.identity.sub,
          id.parse(req.params.id),
        ),
      });
    }),
  );
  app.get('/api/v1/openapi.json', (_req, res) => res.json(openapi));
  app.get(
    '/api/v1/admin/health',
    guard,
    admin,
    endpoint(async (_req, res) => {
      const started = performance.now();
      try {
        await deadline(deps.ready(), 3000);
        const heartbeat = deps.workerHeartbeat
          ? await deadline(deps.workerHeartbeat())
          : null;
        const timestamp = heartbeat ? Date.parse(heartbeat) : NaN;
        const workerHealthy =
          Number.isFinite(timestamp) &&
          Date.now() - timestamp < 180000 &&
          timestamp <= Date.now() + 5000;
        const groups = await deps.db.outboxEvent.groupBy({
          by: ['status'],
          _count: { _all: true },
        });
        const queue = { PENDING: 0, PUBLISHED: 0, PROCESSED: 0, DEAD: 0 };
        for (const group of groups) queue[group.status] = group._count._all;
        const oldest = await deps.db.outboxEvent.findFirst({
          where: { status: { in: ['PENDING', 'PUBLISHED'] } },
          orderBy: { createdAt: 'asc' },
          select: { createdAt: true },
        });
        const memory = process.memoryUsage();
        const healthy = !deps.workerHeartbeat || workerHealthy;
        res.status(healthy ? 200 : 503).json({
          data: {
            status: healthy ? 'ok' : 'degraded',
            timestamp: new Date().toISOString(),
            dependencyLatencyMs: Math.round(performance.now() - started),
            worker: {
              configured: Boolean(deps.workerHeartbeat),
              healthy: workerHealthy,
              lastSeen: Number.isFinite(timestamp)
                ? new Date(timestamp).toISOString()
                : null,
            },
            queue: {
              ...queue,
              oldestPendingSeconds: oldest
                ? Math.max(
                    0,
                    Math.floor(
                      (Date.now() - oldest.createdAt.getTime()) / 1000,
                    ),
                  )
                : 0,
            },
            cache: deps.cache.getStats?.() ?? null,
            memory: {
              rssBytes: memory.rss,
              heapUsedBytes: memory.heapUsed,
              heapLimitBytes: getHeapStatistics().heap_size_limit,
            },
          },
        });
      } catch {
        res.status(503).json({
          error: {
            code: 'DEPENDENCY_UNAVAILABLE',
            message: 'A required dependency is unavailable',
            requestId: res.locals.requestId,
          },
        });
      }
    }),
  );
  app.use('/api/v1', contentRouter(deps.db, guard));
  app.use('/api/v1', catalogRouter(catalog, guard));
  app.get(
    '/api/v1/search',
    rateLimit(deps.limiter, 'search', 30),
    endpoint(async (req, res) => {
      const query = productQuery.parse(req.query);
      if (!query.q)
        throw new AppError(400, 'QUERY_REQUIRED', 'Search requires q');
      res.json(await new SearchService(catalog, deps.semantic).search(query));
    }),
  );
  app.use('/api/v1/cart', cartRouter(new CartService(deps.db, pricing), guard));
  app.get(
    '/api/v1/orders/preview',
    guard,
    endpoint(async (_req, res) =>
      res.json({
        data: await new CartService(deps.db, pricing).view(
          res.locals.identity.sub,
        ),
      }),
    ),
  );
  app.post(
    '/api/v1/orders/:id/payment',
    guard,
    endpoint(async (req, res) =>
      res.json({
        data: await payments.start(
          res.locals.identity.sub,
          id.parse(req.params.id),
        ),
      }),
    ),
  );
  app.use(
    '/api/v1',
    orderRouter(
      new OrderService(
        deps.db,
        pricing,
        deps.cache,
        new CheckoutPolicy(
          config.CHECKOUT_RULES_JSON,
          deps.paymentGateway ? config.PAYSTACK_CURRENCIES : undefined,
        ),
      ),
      guard,
    ),
  );
  app.use((_req, _res, next) =>
    next(new AppError(404, 'NOT_FOUND', 'Route not found')),
  );
  const errors: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
    if (error instanceof ZodError) {
      res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid request',
          details: error.issues.map((x) => ({
            path: x.path.join('.'),
            message: x.message,
          })),
          requestId: res.locals.requestId,
        },
      });
      return;
    }
    let status = 500,
      code = 'INTERNAL_ERROR',
      message = 'An unexpected error occurred';
    if (error instanceof AppError) {
      ({ status, code, message } = error);
    } else if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') {
        status = 409;
        code = 'CONFLICT';
        message = 'Resource already exists';
      }
      if (error.code === 'P2003') {
        status = 409;
        code = 'RELATION_CONFLICT';
        message = 'Related resource is missing or still in use';
      }
      if (error.code === 'P2025') {
        status = 404;
        code = 'NOT_FOUND';
        message = 'Resource not found';
      }
      if (error.code === 'P2034') {
        status = 409;
        code = 'RETRY_TRANSACTION';
        message = 'Concurrent change; retry the request';
      }
    } else if (error instanceof SyntaxError && 'body' in error) {
      status = 400;
      code = 'INVALID_JSON';
      message = 'Malformed JSON body';
    } else if (
      typeof error === 'object' &&
      error !== null &&
      'type' in error &&
      error.type === 'entity.too.large'
    ) {
      status = 413;
      code = 'PAYLOAD_TOO_LARGE';
      message = 'Request body exceeds limit';
    }
    if (status === 500)
      deps.logger.error(
        {
          requestId: res.locals.requestId,
          errorType: error instanceof Error ? error.name : 'Unknown',
        },
        'request failed',
      );
    res
      .status(status)
      .json({ error: { code, message, requestId: res.locals.requestId } });
  };
  app.use(errors);
  return app;
}
