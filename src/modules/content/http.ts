import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { Database } from '../../infrastructure/database';
import { endpoint } from '../../shared/http';
import { assert } from '../../shared/errors';
import { admin } from '../auth/http';
import { contentSchema, defaultContent } from './schema';
export function contentRouter(db: Database, guard: RequestHandler) {
  const router = Router();
  const read = async () => {
    const stored = await db.storeContent.findUnique({
      where: { id: 'homepage' },
    });
    return {
      content: stored ? contentSchema.parse(stored.content) : defaultContent,
      revision: stored?.revision ?? 0,
    };
  };
  router.get(
    '/site-content',
    endpoint(async (_req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      res.json({ data: await read() });
    }),
  );
  router.get(
    '/admin/content',
    guard,
    admin,
    endpoint(async (_req, res) => res.json({ data: await read() })),
  );
  router.put(
    '/admin/content',
    guard,
    admin,
    endpoint(async (req, res) => {
      const input = z
        .object({ revision: z.number().int().min(0), content: contentSchema })
        .strict()
        .parse(req.body);
      const saved = await db.$transaction(async (tx) => {
        await tx.storeContent.upsert({
          where: { id: 'homepage' },
          create: { id: 'homepage', content: defaultContent, revision: 0 },
          update: {},
        });
        const result = await tx.storeContent.updateMany({
          where: { id: 'homepage', revision: input.revision },
          data: { content: input.content, revision: { increment: 1 } },
        });
        assert(
          result.count,
          409,
          'CONTENT_CHANGED',
          'Another administrator updated the homepage. Reload before saving.',
        );
        await tx.auditEvent.create({
          data: {
            actorId: res.locals.identity.sub,
            action: 'content.updated',
            entityId: 'homepage',
          },
        });
        return { content: input.content, revision: input.revision + 1 };
      });
      res.json({ data: saved });
    }),
  );
  return router;
}
