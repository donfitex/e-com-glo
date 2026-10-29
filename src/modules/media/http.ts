import { Router, raw, type RequestHandler } from 'express';
import { admin } from '../auth/http';
import { endpoint } from '../../shared/http';
import { id } from '../../shared/validation';
import { AppError } from '../../shared/errors';
import { ProductImages } from './service';

export function mediaRouter(
  images: ProductImages,
  guard: RequestHandler,
  limit: RequestHandler,
) {
  const router = Router();
  router.post(
    '/admin/images',
    guard,
    admin,
    limit,
    raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: '3mb' }),
    endpoint(async (req, res) => {
      if (!Buffer.isBuffer(req.body) || !req.body.length)
        throw new AppError(
          415,
          'INVALID_IMAGE_TYPE',
          'Choose a JPEG, PNG or WebP image.',
        );
      res
        .status(201)
        .json({ data: await images.upload(res.locals.identity.sub, req.body) });
    }),
  );
  router.get(
    '/media/:id',
    endpoint(async (req, res) => {
      const image = await images.read(id.parse(req.params.id));
      res
        .set({
          'Content-Type': image.contentType,
          'Cache-Control': 'public, max-age=31536000, immutable',
          'X-Content-Type-Options': 'nosniff',
        })
        .send(Buffer.from(image.data));
    }),
  );
  return router;
}
