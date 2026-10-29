import { Router, type RequestHandler } from 'express';
import { endpoint } from '../../shared/http';
import { id, pagination } from '../../shared/validation';
import { WishlistService } from './service';
export function wishlistRouter(
  service: WishlistService,
  guard: RequestHandler,
) {
  const router = Router();
  router.use(guard);
  router.get(
    '/ids',
    endpoint(async (_req, res) =>
      res.json({ data: await service.ids(res.locals.identity.sub) }),
    ),
  );
  router.get(
    '/',
    endpoint(async (req, res) => {
      const query = pagination.parse(req.query);
      res.json({
        data: await service.list(
          res.locals.identity.sub,
          query.page,
          query.limit,
        ),
      });
    }),
  );
  router.post(
    '/:id',
    endpoint(async (req, res) =>
      res.json({
        data: await service.save(
          res.locals.identity.sub,
          id.parse(req.params.id),
        ),
      }),
    ),
  );
  router.delete(
    '/:id',
    endpoint(async (req, res) => {
      await service.remove(res.locals.identity.sub, id.parse(req.params.id));
      res.status(204).end();
    }),
  );
  return router;
}
