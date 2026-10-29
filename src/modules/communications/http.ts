import { Router, RequestHandler } from 'express';
import { z } from 'zod';
import { endpoint } from '../../shared/http';
import { admin } from '../auth/http';
import { id, pagination } from '../../shared/validation';
import { broadcastInput, CommunicationsService } from './service';
export function communicationsRouter(
  service: CommunicationsService,
  guard: RequestHandler,
) {
  const r = Router();
  r.use(['/announcements', '/preferences', '/admin/broadcasts'], guard);
  r.get(
    '/announcements',
    endpoint(async (q, s) => {
      const p = pagination.parse(q.query);
      s.json({
        data: await service.list(s.locals.identity.sub, p.page, p.limit),
      });
    }),
  );
  r.get(
    '/announcements/summary',
    endpoint(async (_q, s) =>
      s.json({ data: { unread: await service.unread(s.locals.identity.sub) } }),
    ),
  );
  r.post(
    '/announcements/:id/read',
    endpoint(async (q, s) =>
      s.json({
        data: await service.read(s.locals.identity.sub, id.parse(q.params.id)),
      }),
    ),
  );
  r.get(
    '/preferences',
    endpoint(async (_q, s) =>
      s.json({ data: await service.preferences(s.locals.identity.sub) }),
    ),
  );
  r.patch(
    '/preferences',
    endpoint(async (q, s) =>
      s.json({
        data: await service.setPreferences(
          s.locals.identity.sub,
          z.object({ promotions: z.boolean() }).strict().parse(q.body)
            .promotions,
        ),
      }),
    ),
  );
  r.get(
    '/admin/broadcasts',
    admin,
    endpoint(async (q, s) => {
      const p = pagination.parse(q.query);
      s.json({ data: await service.adminList(p.page, p.limit) });
    }),
  );
  r.post(
    '/admin/broadcasts',
    admin,
    endpoint(async (q, s) =>
      s.status(201).json({
        data: await service.draft(
          s.locals.identity.sub,
          broadcastInput.parse(q.body),
        ),
      }),
    ),
  );
  r.post(
    '/admin/broadcasts/:id/publish',
    admin,
    endpoint(async (q, s) =>
      s.json({
        data: await service.publish(
          s.locals.identity.sub,
          id.parse(q.params.id),
        ),
      }),
    ),
  );
  r.post(
    '/admin/broadcasts/:id/archive',
    admin,
    endpoint(async (q, s) =>
      s.json({
        data: await service.archive(
          s.locals.identity.sub,
          id.parse(q.params.id),
        ),
      }),
    ),
  );
  return r;
}
