import { Router, RequestHandler } from 'express';
import { z } from 'zod';
import { Tokens, Identity } from './security';
import { AuthService } from './service';
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
export function authenticate(tokens: Tokens): RequestHandler {
  return (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const header = req.headers.authorization;
      if (!header?.startsWith('Bearer '))
        throw new AppError(401, 'UNAUTHORIZED', 'Bearer token required');
      res.locals.identity = tokens.verify(header.slice(7));
      next();
    } catch (e) {
      next(e);
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
    limit,
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
