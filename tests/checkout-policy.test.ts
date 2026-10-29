import { CheckoutPolicy, checkoutRules } from '../src/modules/checkout/policy';
const policy = new CheckoutPolicy([
  {
    country: 'US',
    currency: 'USD',
    shipping: 700,
    taxBasisPoints: 825,
    freeShippingAbove: 10000,
  },
]);
test('shipping and tax use exact minor units and one order-level rounding', () =>
  expect(policy.quote(1999, 'USD', 'US')).toMatchObject({
    subtotal: 1999,
    shipping: 700,
    tax: 165,
    total: 2864,
  }));
test('shipping threshold applies without changing tax rules', () =>
  expect(policy.quote(10000, 'USD', 'US')).toMatchObject({
    shipping: 0,
    tax: 825,
    total: 10825,
  }));
test('unsupported destination or currency cannot silently check out', () => {
  expect(() => policy.quote(2000, 'EUR', 'US')).toThrow('not configured');
  expect(() => policy.quote(2000, 'USD', 'ZZ')).toThrow('not configured');
});
test('rejects duplicate destination rules', () =>
  expect(() =>
    checkoutRules.parse([
      { country: 'US', currency: 'USD', shipping: 0, taxBasisPoints: 0 },
      { country: 'US', currency: 'USD', shipping: 10, taxBasisPoints: 1 },
    ]),
  ).toThrow());

test('configured payment currencies are checked before accepting a positive-value quote', () => {
  const policy = new CheckoutPolicy(
    [{ country: 'US', currency: 'USD', shipping: 0, taxBasisPoints: 0 }],
    ['NGN'],
  );
  expect(() => policy.quote(100, 'USD', 'US')).toThrow('not enabled');
  expect(policy.quote(0, 'USD', 'US').total).toBe(0);
});
