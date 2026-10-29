import { Router, RequestHandler } from 'express';
import { z } from 'zod';
import { address, id } from '../../shared/validation';
import { endpoint } from '../../shared/http';
import { AddressService } from './service';
export function addressRouter(service: AddressService, guard: RequestHandler) {
  const r = Router();
  r.use(guard);
  r.get(
    '/',
    endpoint(async (_q, s) =>
      s.json({ data: await service.list(s.locals.identity.sub) }),
    ),
  );
  r.post(
    '/',
    endpoint(async (q, s) => {
      const body = z
        .object({ address, label: z.string().trim().min(1).max(60) })
        .strict()
        .parse(q.body);
      s.status(201).json({
        data: await service.save(
          s.locals.identity.sub,
          body.address,
          body.label,
        ),
      });
    }),
  );
  r.patch(
    '/:id/default',
    endpoint(async (q, s) =>
      s.json({
        data: await service.default(
          s.locals.identity.sub,
          id.parse(q.params.id),
        ),
      }),
    ),
  );
  r.delete(
    '/:id',
    endpoint(async (q, s) => {
      await service.remove(s.locals.identity.sub, id.parse(q.params.id));
      s.status(204).end();
    }),
  );
  return r;
}
