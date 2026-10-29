import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
const db = new PrismaClient();
async function main() {
  if (process.env.ALLOW_DEMO_SEED !== 'true')
    throw new Error(
      'Set ALLOW_DEMO_SEED=true for a development or staging catalog',
    );
  const products = [
    [
      'electronics',
      'EG-AUDIO-001',
      'Everyday wireless headphones',
      'Find your focus with softly cushioned wireless headphones. A comfortable companion for work, walks and slow mornings.',
      7900,
      'headphones',
      'Sage green',
    ],
    [
      'fashion',
      'EG-BAG-001',
      'The everyday canvas tote',
      'A considered carryall for your daily essentials. Structured cotton canvas, comfortable handles and room for a little extra.',
      3400,
      'bag',
      'Natural canvas',
    ],
    [
      'home-living',
      'EG-LAMP-001',
      'Terra ambient table lamp',
      'A warm glow, a sculptural silhouette. Bring a little character to your bedside, reading nook or favorite corner.',
      5900,
      'lamp',
      'Terracotta',
    ],
    [
      'sports',
      'EG-BOTTLE-001',
      'Wander insulated bottle',
      'Keep your everyday adventures going. A reusable insulated bottle with an easy-carry handle and a clean, minimal finish.',
      2800,
      'bottle',
      'Forest green',
    ],
    [
      'fashion',
      'EG-SHOES-001',
      'Everyday low-top sneakers',
      'An understated silhouette for your daily rhythm. Soft neutral tones and a comfortable low-top profile.',
      6800,
      'shoes',
      'Oat & sage',
    ],
    [
      'beauty',
      'EG-CARE-001',
      'Daily hydration essentials',
      'A simple approach to your daily ritual. Hydrating lotion and face cream in a thoughtfully paired set.',
      4200,
      'skincare',
      'Daily essentials',
    ],
    [
      'books',
      'EG-BOOK-001',
      'A quieter kind of life',
      'A thoughtfully illustrated collection of notes on finding joy in the ordinary and making room for what matters.',
      2400,
      'book',
      'Hardcover',
    ],
    [
      'electronics',
      'EG-SPEAKER-001',
      'Studio portable speaker',
      'Good sound, wherever your day takes you. A compact speaker with a warm finish and a convenient carry handle.',
      6500,
      'speaker',
      'Sandstone',
    ],
  ];
  const ngnPrices: Record<string, number> = {
    'EG-AUDIO-001': 11900000,
    'EG-BAG-001': 4900000,
    'EG-LAMP-001': 8900000,
    'EG-BOTTLE-001': 3900000,
    'EG-SHOES-001': 9900000,
    'EG-CARE-001': 5900000,
    'EG-BOOK-001': 2900000,
    'EG-SPEAKER-001': 9500000,
  };
  for (const [
    slug,
    sku,
    name,
    description,
    price,
    illustration,
    color,
  ] of products) {
    const category = await db.category.findUniqueOrThrow({
      where: { slug: String(slug) },
    });
    await db.product.upsert({
      where: { sku: `${sku}-NGN` },
      create: {
        sku: `${sku}-NGN`,
        name: String(name),
        description: String(description),
        price: ngnPrices[String(sku)]!,
        currency: 'NGN',
        stock: 25,
        categoryId: category.id,
        attributes: {
          illustration: String(illustration),
          color: String(color),
        },
      },
      update: {},
    });
    await db.product.upsert({
      where: { sku: String(sku) },
      create: {
        sku: String(sku),
        name: String(name),
        description: String(description),
        price: Number(price),
        currency: 'USD',
        stock: 25,
        categoryId: category.id,
        attributes: {
          illustration: String(illustration),
          color: String(color),
        },
      },
      update: {},
    });
  }
}
main()
  .catch(() => {
    process.stderr.write(
      'Demo seed failed; ensure category seed ran and ALLOW_DEMO_SEED is explicitly enabled.\n',
    );
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
