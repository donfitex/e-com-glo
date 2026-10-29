import { Product } from '@prisma/client';
import { PricingService } from '../src/modules/cart/pricing';
const product: Product = {
  id: 'product',
  sku: 'SKU',
  name: 'Product',
  description: '',
  price: 1999,
  currency: 'USD',
  stock: 10,
  active: true,
  attributes: {},
  categoryId: 'category',
  createdAt: new Date(),
  updatedAt: new Date(),
};
const pricing = new PricingService();
test('calculates exact minor-unit totals and immutable snapshot fields', () => {
  const quote = pricing.calculate([{ quantity: 3, product }]);
  expect(quote.total).toBe(5997);
  expect(quote.items[0]).toMatchObject({
    price: 1999,
    lineTotal: 5997,
    sku: 'SKU',
  });
});
test.each([
  { ...product, active: false },
  { ...product, stock: 0 },
])('rejects unavailable inventory', (p) =>
  expect(() => pricing.calculate([{ quantity: 1, product: p }])).toThrow(),
);
test('rejects mixed currency totals', () =>
  expect(() =>
    pricing.calculate([
      { quantity: 1, product },
      { quantity: 1, product: { ...product, currency: 'JPY' } },
    ]),
  ).toThrow('same currency'));
test('guards database money overflow', () =>
  expect(() =>
    pricing.calculate([
      { quantity: 100, product: { ...product, stock: 100, price: 1000000000 } },
    ]),
  ).toThrow('supported limit'));
test('does not invent a currency for empty carts', () =>
  expect(pricing.calculate([])).toMatchObject({ total: 0, currency: null }));
