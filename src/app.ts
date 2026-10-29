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
import { authRouter, authenticate } from './modules/auth/http';
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
export interface Dependencies {
  db: Database;
  cache: Cache;
  limiter: RateLimiter;
  passwords: PasswordHasher;
  tokens: Tokens;
  logger: Logger;
  ready: () => Promise<void>;
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
  app.use(express.json({ limit: '64kb' }));
  app.get('/health', (_req, res) =>
    res.json({ status: 'ok', service: 'E-com Global' }),
  );
  app.get(
    '/ready',
    endpoint(async (_req, res) => {
      try {
        await deps.ready();
        res.json({ status: 'ready' });
      } catch {
        res.status(503).json({ status: 'unavailable' });
      }
    }),
  );
  app.use('/api/v1', rateLimit(deps.limiter, 'api', 120));
  const guard = authenticate(deps.tokens);
  const pricing = new PricingService();
  const catalog = new CatalogService(
    new CatalogRepository(deps.db),
    deps.db,
    deps.cache,
  );
  app.use(
    '/api/v1/auth',
    authRouter(
      new AuthService(deps.db, deps.passwords, deps.tokens),
      guard,
      rateLimit(deps.limiter, 'auth', 10),
    ),
  );
  app.use('/api/v1', catalogRouter(catalog, guard));
  app.get(
    '/api/v1/search',
    rateLimit(deps.limiter, 'search', 30),
    endpoint(async (req, res) => {
      const query = productQuery.parse(req.query);
      if (!query.q)
        throw new AppError(400, 'QUERY_REQUIRED', 'Search requires q');
      res.json({ data: await catalog.list(query), meta: { mode: 'text' } });
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
  app.use(
    '/api/v1',
    orderRouter(new OrderService(deps.db, pricing, deps.cache), guard),
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
