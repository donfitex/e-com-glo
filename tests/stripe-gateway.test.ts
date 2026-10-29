import Stripe from 'stripe';
import { StripeGateway } from '../src/modules/payments/gateway';
const secret = 'whsec_test_fixture';
const gateway = new StripeGateway(
  'sk_test_fixture',
  secret,
  'https://shop.example',
);
function sign(body: string) {
  return Stripe.webhooks.generateTestHeaderString({ payload: body, secret });
}
test('verifies authentic Stripe signatures and normalizes paid events', () => {
  const body = JSON.stringify({
    id: 'evt_paid',
    livemode: false,
    type: 'checkout.session.completed',
    data: {
      object: {
        id: 'cs_test_fixture',
        client_reference_id: 'order-id',
        payment_status: 'paid',
        amount_total: 2864,
        currency: 'usd',
      },
    },
  });
  expect(gateway.verify(Buffer.from(body), sign(body))).toMatchObject({
    id: 'evt_paid',
    type: 'paid',
    amount: 2864,
    currency: 'USD',
  });
});
test('rejects forged and live payment notifications', () => {
  const body = JSON.stringify({
    id: 'evt_live',
    livemode: true,
    type: 'checkout.session.completed',
    data: { object: {} },
  });
  expect(() => gateway.verify(Buffer.from(body), 'forged')).toThrow();
  expect(() => gateway.verify(Buffer.from(body), sign(body))).toThrow(
    'Live payments are disabled',
  );
});
test('a completed session with an unpaid payment state is not paid', () => {
  const body = JSON.stringify({
    id: 'evt_wait',
    livemode: false,
    type: 'checkout.session.completed',
    data: { object: { id: 'cs_pending', payment_status: 'unpaid' } },
  });
  expect(gateway.verify(Buffer.from(body), sign(body)).type).toBe('ignored');
});
