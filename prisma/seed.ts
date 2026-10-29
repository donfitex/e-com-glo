import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
const db = new PrismaClient();
async function main() {
  const categories = [
    ['Electronics', 'electronics'],
    ['Fashion', 'fashion'],
    ['Home & Living', 'home-living'],
    ['Beauty & Personal Care', 'beauty'],
    ['Sports & Outdoors', 'sports'],
    ['Books & Media', 'books'],
    ['Groceries', 'groceries'],
    ['Toys & Games', 'toys'],
  ];
  for (const [name, slug] of categories)
    await db.category.upsert({
      where: { slug },
      create: { name: name!, slug: slug! },
      update: {},
    });
  // No default administrator or shared password. Provision administrators explicitly.
}
main()
  .catch(() => {
    process.stderr.write(
      'Catalog seeding failed; verify database configuration.\n',
    );
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
