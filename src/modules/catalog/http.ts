import { Router, RequestHandler } from 'express';
import { id } from '../../shared/validation';
import { endpoint } from '../../shared/http';
import { admin } from '../auth/http';
import { CatalogService } from './service';
import { categoryInput, productInput, productQuery } from './schemas';
export function catalogRouter(service: CatalogService, guard: RequestHandler) {
  const r = Router();
  r.get(
    '/categories',
    endpoint(async (_req, res) =>
      res.json({ data: await service.categories() }),
    ),
  );
  r.post(
    '/categories',
    guard,
    admin,
    endpoint(async (req, res) =>
      res.status(201).json({
        data: await service.saveCategory(
          res.locals.identity.sub,
          categoryInput.parse(req.body),
        ),
      }),
    ),
  );
  r.patch(
    '/categories/:id',
    guard,
    admin,
    endpoint(async (req, res) =>
      res.json({
        data: await service.saveCategory(
          res.locals.identity.sub,
          categoryInput.parse(req.body),
          id.parse(req.params.id),
        ),
      }),
    ),
  );
  r.delete(
    '/categories/:id',
    guard,
    admin,
    endpoint(async (req, res) => {
      await service.deleteCategory(
        res.locals.identity.sub,
        id.parse(req.params.id),
      );
      res.sendStatus(204);
    }),
  );
  r.get(
    '/products',
    endpoint(async (req, res) =>
      res.json({ data: await service.list(productQuery.parse(req.query)) }),
    ),
  );
  r.get(
    '/products/:id',
    endpoint(async (req, res) =>
      res.json({ data: await service.detail(id.parse(req.params.id)) }),
    ),
  );
  r.post(
    '/products',
    guard,
    admin,
    endpoint(async (req, res) =>
      res.status(201).json({
        data: await service.saveProduct(
          res.locals.identity.sub,
          productInput.parse(req.body),
        ),
      }),
    ),
  );
  r.patch(
    '/products/:id',
    guard,
    admin,
    endpoint(async (req, res) =>
      res.json({
        data: await service.saveProduct(
          res.locals.identity.sub,
          productInput.partial().parse(req.body),
          id.parse(req.params.id),
        ),
      }),
    ),
  );
  r.delete(
    '/products/:id',
    guard,
    admin,
    endpoint(async (req, res) => {
      await service.saveProduct(
        res.locals.identity.sub,
        { active: false },
        id.parse(req.params.id),
      );
      res.sendStatus(204);
    }),
  );
  return r;
}
