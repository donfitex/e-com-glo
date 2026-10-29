import { deliveryWindow, shipmentInput } from '../src/modules/orders/delivery';
import { checkoutRules } from '../src/modules/checkout/policy';

test('calendar-day delivery estimates cross month and year boundaries in UTC', () => {
  const window = deliveryWindow(new Date('2026-12-30T23:30:00.000Z'), 3, 7);
  expect(window.estimatedDeliveryFrom.toISOString()).toBe(
    '2027-01-02T23:30:00.000Z',
  );
  expect(window.estimatedDeliveryTo.toISOString()).toBe(
    '2027-01-06T23:30:00.000Z',
  );
});
test('delivery windows and carrier links reject invalid configuration', () => {
  expect(() =>
    checkoutRules.parse([
      {
        country: 'NG',
        currency: 'NGN',
        shipping: 0,
        taxBasisPoints: 0,
        deliveryMinDays: 8,
        deliveryMaxDays: 3,
      },
    ]),
  ).toThrow();
  expect(() =>
    shipmentInput.parse({ trackingUrl: 'javascript:alert(1)' }),
  ).toThrow();
  expect(() =>
    shipmentInput.parse({
      trackingUrl: 'https://user:password@example.com/track',
    }),
  ).toThrow();
  expect(() =>
    shipmentInput.parse({ expectedDeliveryDate: '2026-02-30' }),
  ).toThrow();
});

test('malformed carrier URLs produce validation errors rather than URL parser exceptions', () => {
  expect(shipmentInput.safeParse({ trackingUrl: 'not a URL' }).success).toBe(
    false,
  );
});
