import { Database } from '../../infrastructure/database';
import { Cache } from '../../infrastructure/cache';
import { Embeddings } from './embeddings';
export class ProductIndexer {
  constructor(
    private readonly db: Database,
    private readonly embeddings: Embeddings,
    private readonly cache: Cache,
  ) {}
  async batch(cursor?: string, limit = 50, productIds?: string[]) {
    const products = await this.db.product.findMany({
      where: {
        active: true,
        ...(productIds ? { id: { in: productIds } } : {}),
      },
      orderBy: { id: 'asc' },
      take: Math.min(100, Math.max(1, limit)),
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    let indexed = 0,
      skipped = 0,
      failed = 0;
    for (const product of products) {
      try {
        const source = `${product.name} ${product.description}`;
        const rows = await this.db.$queryRaw<
          { model: string; sourceText: string }[]
        >`SELECT model,"sourceText" FROM "ProductEmbedding" WHERE "productId"=${product.id}::uuid`;
        if (
          rows[0]?.model === this.embeddings.model &&
          rows[0].sourceText === source
        ) {
          skipped++;
          continue;
        }
        const vector = JSON.stringify(await this.embeddings.embed(source));
        const saved = await this.db.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT id FROM "Product" WHERE id=${product.id}::uuid FOR UPDATE`;
          const current = await tx.product.findUnique({
            where: { id: product.id },
          });
          if (
            !current?.active ||
            `${current.name} ${current.description}` !== source
          )
            return false;
          await tx.$executeRaw`INSERT INTO "ProductEmbedding" ("productId",model,"sourceText",embedding) VALUES (${product.id}::uuid,${this.embeddings.model},${source},${vector}::vector) ON CONFLICT ("productId") DO UPDATE SET model=EXCLUDED.model,"sourceText"=EXCLUDED."sourceText",embedding=EXCLUDED.embedding`;
          return true;
        });
        if (saved) indexed++;
        else skipped++;
      } catch {
        failed++;
      }
    }
    if (indexed) await this.cache.invalidate();
    return { indexed, skipped, failed, cursor: products.at(-1)?.id };
  }
  async removeInactive() {
    await this.db.$transaction(async (tx) => {
      await tx.$executeRaw`DELETE FROM "ProductEmbedding" e USING "Product" p WHERE e."productId"=p.id AND p.active=false`;
    });
    await this.cache.invalidate();
  }
}
