import { recoveryEnvelope } from '../recovery/message-keys';
import { Router, RequestHandler } from 'express';
import { z } from 'zod';
import { endpoint } from '../../shared/http';
import { id, pagination } from '../../shared/validation';
import { ConversationService } from './service';
import {
  customerKeyInput,
  conversationEnvelope,
  startConversation,
} from './schema';
export function conversationRouter(
  service: ConversationService,
  guard: RequestHandler,
  limit: RequestHandler,
) {
  const r = Router();
  r.use(guard);
  r.get(
    '/recovery-key',
    endpoint(async (_q, s) => s.json({ data: await service.recoveryKey() })),
  );
  r.post(
    '/recovery',
    limit,
    endpoint(async (q, s) =>
      s.json({
        data: await service.saveRecovery(
          s.locals.identity,
          recoveryEnvelope.parse(q.body),
        ),
      }),
    ),
  );
  r.get(
    '/vault',
    endpoint(async (_q, s) =>
      s.json({ data: await service.vault(s.locals.identity) }),
    ),
  );
  r.get(
    '/key',
    endpoint(async (_q, s) =>
      s.json({ data: await service.ownKey(s.locals.identity) }),
    ),
  );
  r.post(
    '/key',
    limit,
    endpoint(async (q, s) =>
      s.status(201).json({
        data: await service.register(
          s.locals.identity,
          customerKeyInput.parse(q.body),
        ),
      }),
    ),
  );
  r.get(
    '/summary',
    endpoint(async (_q, s) =>
      s.json({ data: { unread: await service.unread(s.locals.identity) } }),
    ),
  );
  r.get(
    '/',
    endpoint(async (q, s) => {
      const p = pagination.parse(q.query);
      s.json({ data: await service.list(s.locals.identity, p.page, p.limit) });
    }),
  );
  r.post(
    '/',
    limit,
    endpoint(async (q, s) =>
      s.status(201).json({
        data: await service.start(
          s.locals.identity,
          startConversation.parse(q.body),
        ),
      }),
    ),
  );
  r.get(
    '/:id',
    endpoint(async (q, s) =>
      s.json({
        data: await service.detail(
          s.locals.identity,
          id.parse(q.params.id),
          z.coerce.number().int().positive().optional().parse(q.query.before),
        ),
      }),
    ),
  );
  r.post(
    '/:id/messages',
    limit,
    endpoint(async (q, s) =>
      s.status(201).json({
        data: await service.send(
          s.locals.identity,
          id.parse(q.params.id),
          conversationEnvelope.parse(q.body),
        ),
      }),
    ),
  );
  r.post(
    '/:id/read',
    endpoint(async (q, s) =>
      s.json({
        data: await service.read(
          s.locals.identity,
          id.parse(q.params.id),
          z
            .object({ sequence: z.number().int().nonnegative() })
            .strict()
            .parse(q.body).sequence,
        ),
      }),
    ),
  );
  r.patch(
    '/:id',
    endpoint(async (q, s) =>
      s.json({
        data: await service.resolve(
          s.locals.identity,
          id.parse(q.params.id),
          z.object({ resolved: z.boolean() }).strict().parse(q.body).resolved,
        ),
      }),
    ),
  );
  return r;
}
