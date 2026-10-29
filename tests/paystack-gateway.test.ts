import { configSchema } from '../src/config';
import { createHmac } from 'node:crypto';
import { PaystackGateway } from '../src/modules/payments/gateway';
const secret = 'sk_test_paystack_fixture';
const orderId = 'e241484c-f388-4d9b-9cd7-f35ccab53280';
const reference = `ecom-${orderId}`;
const data = {
  id: 123456,
  domain: 'test',
  status: 'success',
  reference,
  amount: 150000,
  currency: 'NGN',
  metadata: { orderId },
};
const body = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({ event: 'charge.success', data: { ...data, ...overrides } });
const sign = (payload: string) =>
  createHmac('sha512', secret).update(payload).digest('hex');
function transport(data: unknown, status = 200) {
  return jest
    .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
    .mockResolvedValue(
      new Response(JSON.stringify({ status: status === 200, data }), {
        status,
      }),
    );
}
test('authenticates raw Paystack signatures and normalizes transaction IDs', () => {
  const gateway = new PaystackGateway(secret, 'https://shop.example');
  const payload = body();
  expect(gateway.verify(Buffer.from(payload), sign(payload))).toMatchObject({
    id: 'paystack:charge:123456',
    type: 'paid',
    orderId,
    reference,
    amount: 150000,
    currency: 'NGN',
    providerTransactionId: '123456',
  });
});
test('rejects forged, malformed, changed and live-domain notifications', () => {
  const gateway = new PaystackGateway(secret, 'https://shop.example');
  const payload = body();
  for (const signature of ['', 'forged', '00'.repeat(64)])
    expect(() => gateway.verify(Buffer.from(payload), signature)).toThrow();
  expect(() =>
    gateway.verify(Buffer.from(body({ amount: 1 })), sign(payload)),
  ).toThrow();
  const live = body({ domain: 'live' });
  expect(() => gateway.verify(Buffer.from(live), sign(live))).toThrow();
});
test('rejects a signed reference/metadata mismatch and ignores unrelated events', () => {
  const gateway = new PaystackGateway(secret, 'https://shop.example');
  const mismatch = body({ reference: 'different-reference' });
  expect(() => gateway.verify(Buffer.from(mismatch), sign(mismatch))).toThrow(
    'does not match',
  );
  const ignored = JSON.stringify({ event: 'transfer.success', data: {} });
  expect(gateway.verify(Buffer.from(ignored), sign(ignored)).type).toBe(
    'ignored',
  );
});
test('initializes in minor units using the server-owned email/reference and callback', async () => {
  const fetcher = transport({
    authorization_url: 'https://checkout.paystack.com/test-code',
    reference,
  });
  const gateway = new PaystackGateway(
    secret,
    'https://shop.example',
    ['NGN'],
    fetcher,
  );
  expect(
    await gateway.create({
      id: orderId,
      email: 'buyer@example.com',
      total: 150000,
      currency: 'NGN',
      expiresAt: new Date(Date.now() + 60000),
    }),
  ).toEqual({ id: reference, url: 'https://checkout.paystack.com/test-code' });
  expect(fetcher.mock.calls[0]?.[0]).toBe(
    'https://api.paystack.co/transaction/initialize',
  );
  expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toMatchObject({
    email: 'buyer@example.com',
    amount: 150000,
    currency: 'NGN',
    reference,
    callback_url: `https://shop.example/checkout/payment?order=${orderId}`,
  });
});
test('rejects disabled currencies, zero amounts, and non-Paystack redirect URLs', async () => {
  const fetcher = transport({
    authorization_url: 'https://untrusted.example/pay',
    reference,
  });
  const gateway = new PaystackGateway(
    secret,
    'https://shop.example',
    ['NGN'],
    fetcher,
  );
  const order = {
    id: orderId,
    email: 'buyer@example.com',
    total: 100,
    currency: 'USD',
    expiresAt: new Date(),
  };
  await expect(gateway.create(order)).rejects.toThrow('not enabled');
  await expect(
    gateway.create({ ...order, currency: 'NGN', total: 0 }),
  ).rejects.toThrow('positive');
  expect(fetcher).not.toHaveBeenCalled();
  await expect(gateway.create({ ...order, currency: 'NGN' })).rejects.toThrow(
    'invalid checkout',
  );
});
test('requires server verification to agree with the authenticated notification', async () => {
  const fetcher = transport(data);
  const gateway = new PaystackGateway(
    secret,
    'https://shop.example',
    ['NGN'],
    fetcher,
  );
  const payload = body();
  const notice = gateway.verify(Buffer.from(payload), sign(payload));
  expect(await gateway.confirm(notice)).toEqual(notice);
  expect(fetcher.mock.calls[0]?.[0]).toBe(
    `https://api.paystack.co/transaction/verify/${reference}`,
  );
  const mismatch = new PaystackGateway(
    secret,
    'https://shop.example',
    ['NGN'],
    transport({ ...data, amount: 1 }),
  );
  await expect(mismatch.confirm(notice)).rejects.toThrow('does not match');
});
test('provider failures remain retryable and never expose upstream errors', async () => {
  const fetcher = transport({ message: 'private provider detail' }, 503);
  const gateway = new PaystackGateway(
    secret,
    'https://shop.example',
    ['NGN'],
    fetcher,
  );
  await expect(
    gateway.create({
      id: orderId,
      email: 'buyer@example.com',
      total: 1000,
      currency: 'NGN',
      expiresAt: new Date(),
    }),
  ).rejects.toMatchObject({
    status: 502,
    code: 'PAYMENT_PROVIDER_UNAVAILABLE',
  });
});

test('runtime configuration accepts a test key and rejects live keys', () => {
  const base = {
    DATABASE_URL: 'postgresql://localhost/ecom_test',
    REDIS_URL: 'redis://localhost',
    CORS_ORIGINS: 'https://shop.example',
    JWT_SECRET: 'configuration-fixture-at-least-32-characters',
  };
  expect(
    configSchema.safeParse({ ...base, PAYSTACK_SECRET_KEY: 'sk_test_fixture' })
      .success,
  ).toBe(true);
  expect(
    configSchema.safeParse({ ...base, PAYSTACK_SECRET_KEY: 'sk_live_fixture' })
      .success,
  ).toBe(false);
});
