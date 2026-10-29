import { Router, RequestHandler } from 'express';
import { z } from 'zod';
import { OrderStatus } from '@prisma/client';
import { address, id, pagination } from '../../shared/validation';
import { endpoint } from '../../shared/http';
import { admin } from '../auth/http';
import { OrderService } from './service';
export function orderRouter(service: OrderService, guard: RequestHandler) {
  const r = Router();
  r.use(guard);
  r.post(
    '/orders/quote',
    endpoint(async (req, res) => {
      const body = z
        .object({ shippingAddress: address })
        .strict()
        .parse(req.body);
      res.json({
        data: await service.quote(
          res.locals.identity.sub,
          body.shippingAddress,
        ),
      });
    }),
  );
  r.post(
    '/orders/checkout',
    endpoint(async (req, res) => {
      const key = z
        .string()
        .min(8)
        .max(100)
        .regex(/^[a-zA-Z0-9_-]+$/)
        .parse(req.headers['idempotency-key']);
      const body = z
        .object({
          shippingAddress: address,
          quote: z
            .object({
              total: z.number().int().nonnegative(),
              ruleVersion: z.string(),
            })
            .strict()
            .optional(),
        })
        .strict()
        .parse(req.body);
      res.status(201).json({
        data: await service.checkout(
          res.locals.identity.sub,
          key,
          body.shippingAddress,
          body.quote,
        ),
      });
    }),
  );
  r.get(
    '/orders',
    endpoint(async (req, res) => {
      const q = pagination.parse(req.query);
      res.json({
        data: await service.list(res.locals.identity.sub, q.page, q.limit),
      });
    }),
  );
  r.get(
    '/orders/:id',
    endpoint(async (req, res) =>
      res.json({
        data: await service.detail(
          res.locals.identity.sub,
          id.parse(req.params.id),
        ),
      }),
    ),
  );
  r.get(
    '/admin/orders',
    admin,
    endpoint(async (req, res) => {
      const q = pagination
        .extend({ status: z.nativeEnum(OrderStatus).optional() })
        .parse(req.query);
      res.json({
        data: await service.list(undefined, q.page, q.limit, q.status),
      });
    }),
  );
  r.patch(
    '/admin/orders/:id/status',
    admin,
    endpoint(async (req, res) =>
      res.json({
        data: await service.transition(
          res.locals.identity.sub,
          id.parse(req.params.id),
          z
            .object({ status: z.nativeEnum(OrderStatus) })
            .strict()
            .parse(req.body).status,
        ),
      }),
    ),
  );
  return r;
}
