import { Prisma } from '@prisma/client';
import { Database } from '../../infrastructure/database';
import { Cache } from '../../infrastructure/cache';
import { ProductQuery } from '../catalog/schemas';
import { Embeddings } from './embeddings';
import { SemanticSearch } from './service';
export class PgVectorSearch implements SemanticSearch {
  constructor(
    private readonly db: Database,
    private readonly embeddings: Embeddings,
    private readonly cache: Cache,
  ) {}
  search(query: ProductQuery) {
    return this.cache.remember(
      `semantic:${this.embeddings.model}:${JSON.stringify(query)}`,
      30,
      async () => {
        const vector = JSON.stringify(await this.embeddings.embed(query.q!));
        // Parameters remain bound, including the vector literal; user input is never SQL text.
        const ids = await this.db.$queryRaw<
          { id: string; total: bigint }[]
        >(Prisma.sql`
    SELECT p.id, COUNT(*) OVER() AS total FROM "ProductEmbedding" e
    JOIN "Product" p ON p.id=e."productId"
    WHERE p.active=true AND e.model=${this.embeddings.model}
    AND e."sourceText"=p.name || ' ' || p.description
    AND 1-(e.embedding <=> ${vector}::vector) >= 0.35
    ${query.categoryId ? Prisma.sql`AND p."categoryId"=${query.categoryId}::uuid` : Prisma.empty}
    ${query.currency ? Prisma.sql`AND p.currency=${query.currency}` : Prisma.empty}
    ${query.minPrice !== undefined ? Prisma.sql`AND p.price>=${query.minPrice}` : Prisma.empty}
    ${query.maxPrice !== undefined ? Prisma.sql`AND p.price<=${query.maxPrice}` : Prisma.empty}
    ${query.available === 'true' ? Prisma.sql`AND p.stock>0` : query.available === 'false' ? Prisma.sql`AND p.stock=0` : Prisma.empty}
    ORDER BY e.embedding <=> ${vector}::vector,p.id
    LIMIT ${query.limit} OFFSET ${(query.page - 1) * query.limit}`);
        const products = await this.db.product.findMany({
          where: { id: { in: ids.map((row) => row.id) }, active: true },
          include: { category: true },
        });
        const lookup = new Map(
          products.map((product) => [product.id, product]),
        );
        return {
          items: ids.flatMap((row) => {
            const product = lookup.get(row.id);
            return product ? [product] : [];
          }),
          total: Number(ids[0]?.total ?? 0),
          page: query.page,
          limit: query.limit,
        };
      },
    );
  }
}
