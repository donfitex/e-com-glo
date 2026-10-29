import { Router, RequestHandler } from 'express';
import { z } from 'zod';
import { id, quantity } from '../../shared/validation';
import { endpoint } from '../../shared/http';
import { CartService } from './service';
export function cartRouter(service: CartService, guard: RequestHandler) {
  const r = Router();
  r.use(guard);
  r.get(
    '/',
    endpoint(async (_req, res) =>
      res.json({ data: await service.view(res.locals.identity.sub) }),
    ),
  );
  r.post(
    '/items',
    endpoint(async (req, res) => {
      const body = z
        .object({ productId: id, quantity })
        .strict()
        .parse(req.body);
      res.json({
        data: await service.set(
          res.locals.identity.sub,
          body.productId,
          body.quantity,
        ),
      });
    }),
  );
  r.patch(
    '/items/:id',
    endpoint(async (req, res) =>
      res.json({
        data: await service.set(
          res.locals.identity.sub,
          id.parse(req.params.id),
          z.object({ quantity }).strict().parse(req.body).quantity,
        ),
      }),
    ),
  );
  r.delete(
    '/items/:id',
    endpoint(async (req, res) => {
      await service.remove(res.locals.identity.sub, id.parse(req.params.id));
      res.sendStatus(204);
    }),
  );
  r.delete(
    '/',
    endpoint(async (_req, res) => {
      await service.remove(res.locals.identity.sub);
      res.sendStatus(204);
    }),
  );
  return r;
}
