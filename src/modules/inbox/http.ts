import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { InboxService } from './service';
import { encryptedMessage, keyInput } from './schema';
import { endpoint } from '../../shared/http';
import { id, pagination } from '../../shared/validation';
import { admin } from '../auth/http';
export function inboxRouter(
  service: InboxService,
  guard: RequestHandler,
  limit: RequestHandler,
) {
  const router = Router();
  router.get(
    '/contact/key',
    endpoint(async (_req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      res.json({ data: await service.activeKey() });
    }),
  );
  router.post(
    '/contact/messages',
    limit,
    endpoint(async (req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      res.status(201).json({
        data: await service.receive(encryptedMessage.parse(req.body)),
      });
    }),
  );
  router.get(
    '/admin/inbox/keys',
    guard,
    admin,
    endpoint(async (_req, res) => res.json({ data: await service.keys() })),
  );
  router.post(
    '/admin/inbox/keys',
    guard,
    admin,
    endpoint(async (req, res) =>
      res.status(201).json({
        data: await service.activate(
          res.locals.identity.sub,
          keyInput.parse(req.body),
        ),
      }),
    ),
  );
  router.get(
    '/admin/inbox/summary',
    guard,
    admin,
    endpoint(async (_req, res) => res.json({ data: await service.summary() })),
  );
  router.get(
    '/admin/inbox/messages',
    guard,
    admin,
    endpoint(async (req, res) => {
      const query = pagination
        .extend({ status: z.enum(['NEW', 'READ', 'RESOLVED']).optional() })
        .parse(req.query);
      res.json({
        data: await service.list(query.page, query.limit, query.status),
      });
    }),
  );
  router.get(
    '/admin/inbox/messages/:id',
    guard,
    admin,
    endpoint(async (req, res) =>
      res.json({ data: await service.detail(id.parse(req.params.id)) }),
    ),
  );
  router.patch(
    '/admin/inbox/messages/:id',
    guard,
    admin,
    endpoint(async (req, res) =>
      res.json({
        data: await service.update(
          res.locals.identity.sub,
          id.parse(req.params.id),
          z
            .object({ status: z.enum(['NEW', 'READ', 'RESOLVED']) })
            .strict()
            .parse(req.body).status,
        ),
      }),
    ),
  );
  router.delete(
    '/admin/inbox/messages/:id',
    guard,
    admin,
    endpoint(async (req, res) => {
      await service.remove(res.locals.identity.sub, id.parse(req.params.id));
      res.status(204).end();
    }),
  );
  return router;
}
