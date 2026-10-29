import { Router, RequestHandler } from 'express';
import { z } from 'zod';
import { endpoint } from '../../shared/http';
import { PasswordRecoveryService } from './service';
export function recoveryRouter(
  service: PasswordRecoveryService,
  limit: RequestHandler,
  accountLimit: RequestHandler,
) {
  const r = Router();
  r.use((_q, s, n) => {
    s.setHeader('Cache-Control', 'no-store');
    n();
  });
  r.post(
    '/forgot-password',
    limit,
    accountLimit,
    endpoint(async (q, s) => {
      const input = z
        .object({ email: z.string().trim().toLowerCase().email().max(254) })
        .strict()
        .parse(q.body);
      s.status(202).json({ data: await service.request(input.email) });
    }),
  );
  r.post(
    '/reset-password',
    limit,
    endpoint(async (q, s) => {
      const input = z
        .object({
          token: z.string().regex(/^[a-f0-9]{64}$/),
          password: z.string().min(12).max(128),
        })
        .strict()
        .parse(q.body);
      s.json({ data: await service.reset(input.token, input.password) });
    }),
  );
  return r;
}
