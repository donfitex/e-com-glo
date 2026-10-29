import { Router, RequestHandler } from 'express';
import { z } from 'zod';
import { Tokens, Identity } from './security';
import { AuthService } from './service';
import type { Database } from '../../infrastructure/database';
import { AppError } from '../../shared/errors';
import { endpoint } from '../../shared/http';
declare global {
  namespace Express {
    interface Locals {
      identity: Identity;
      requestId: string;
    }
  }
}
const credentials = z
  .object({
    email: z.string().trim().toLowerCase().email().max(254),
    password: z.string().min(12).max(128),
  })
  .strict();
export function authenticate(tokens: Tokens, db: Database): RequestHandler {
  return (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const header = req.headers.authorization;
      if (!header?.startsWith('Bearer '))
        throw new AppError(401, 'UNAUTHORIZED', 'Bearer token required');
      const identity = tokens.verify(header.slice(7));
      void db.user
        .findUnique({
          where: { id: identity.sub },
          select: { sessionVersion: true, role: true },
        })
        .then((user) => {
          if (
            !user ||
            user.sessionVersion !== (identity.version ?? 0) ||
            user.role !== identity.role
          )
            throw new AppError(
              401,
              'UNAUTHORIZED',
              'Session expired. Sign in again.',
            );
          res.locals.identity = identity;
          next();
        })
        .catch(next);
    } catch (error) {
      next(error);
    }
  };
}
export const admin: RequestHandler = (_req, res, next) =>
  res.locals.identity.role === 'ADMIN'
    ? next()
    : next(new AppError(403, 'FORBIDDEN', 'Administrator access required'));
export function authRouter(
  service: AuthService,
  guard: RequestHandler,
  limit: RequestHandler,
  loginLimit: RequestHandler = limit,
) {
  const router = Router();
  router.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  router.post(
    '/register',
    limit,
    endpoint(async (req, res) =>
      res.status(201).json({
        data: await service.register(
          credentials
            .extend({ name: z.string().trim().min(1).max(120) })
            .parse(req.body),
        ),
      }),
    ),
  );
  router.post(
    '/login',
    loginLimit,
    endpoint(async (req, res) =>
      res.json({ data: await service.login(credentials.parse(req.body)) }),
    ),
  );
  router.get(
    '/me',
    guard,
    endpoint(async (_req, res) =>
      res.json({ data: await service.me(res.locals.identity.sub) }),
    ),
  );
  return router;
}
