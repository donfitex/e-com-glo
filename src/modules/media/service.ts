import sharp from 'sharp';
import { Database } from '../../infrastructure/database';
import { AppError } from '../../shared/errors';

// Isolated image storage boundary; durable across Render restarts and replicas.
export class ProductImages {
  constructor(private readonly db: Database) {}
  async upload(actorId: string, input: Buffer) {
    let data: Buffer;
    try {
      const image = sharp(input, {
        limitInputPixels: 20_000_000,
        animated: false,
      });
      const meta = await image.metadata();
      if (!['jpeg', 'png', 'webp'].includes(meta.format ?? ''))
        throw new Error('Unsupported format');
      data = await image
        .rotate()
        .resize({
          width: 1600,
          height: 1600,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .webp({ quality: 82 })
        .toBuffer();
    } catch {
      throw new AppError(
        422,
        'INVALID_IMAGE',
        'Upload a valid JPEG, PNG or WebP image, up to 3 MB and 20 megapixels.',
      );
    }
    if (data.length > 1024 * 1024)
      throw new AppError(422, 'IMAGE_TOO_LARGE', 'Choose a smaller image.');
    const image = await this.db.$transaction(async (tx) => {
      const saved = await tx.productImage.create({
        data: { data, contentType: 'image/webp' },
        select: { id: true },
      });
      await tx.auditEvent.create({
        data: { actorId, action: 'product.image_uploaded', entityId: saved.id },
      });
      return saved;
    });
    return { url: `/api/media/${image.id}` };
  }
  async read(id: string) {
    const image = await this.db.productImage.findUnique({ where: { id } });
    if (!image) throw new AppError(404, 'NOT_FOUND', 'Image not found');
    return image;
  }
}
