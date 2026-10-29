import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { LocalEmbeddings } from '../src/modules/search/embeddings';
const db = new PrismaClient();
async function main() {
  if (!process.env.SEMANTIC_SEARCH_URL)
    throw new Error('SEMANTIC_SEARCH_URL required');
  const embeddings = new LocalEmbeddings(process.env.SEMANTIC_SEARCH_URL);
  let cursor: string | undefined;
  for (;;) {
    const products = await db.product.findMany({
      where: { active: true },
      orderBy: { id: 'asc' },
      take: 100,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (!products.length) break;
    for (const product of products) {
      const vector = JSON.stringify(
        await embeddings.embed(`${product.name} ${product.description}`),
      );
      await db.$executeRaw`INSERT INTO "ProductEmbedding" ("productId",model,"sourceText",embedding)
    VALUES (${product.id}::uuid,${embeddings.model},${`${product.name} ${product.description}`},${vector}::vector)
    ON CONFLICT ("productId") DO UPDATE SET model=EXCLUDED.model,"sourceText"=EXCLUDED."sourceText",embedding=EXCLUDED.embedding`;
    }
    cursor = products.at(-1)!.id;
  }
}
main()
  .catch(() => {
    process.stderr.write(
      'Search indexing failed; check pgvector and local model service.\n',
    );
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
