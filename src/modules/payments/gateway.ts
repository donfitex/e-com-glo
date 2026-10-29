import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { AppError, assert } from '../../shared/errors';
export interface PaymentNotice {
  id: string;
  type: 'paid' | 'ignored';
  orderId?: string;
  reference?: string;
  amount?: number;
  currency?: string;
  providerTransactionId?: string;
}
export interface PaymentGateway {
  create(order: {
    id: string;
    currency: string;
    total: number;
    email: string;
    expiresAt: Date;
  }): Promise<{ id: string; url: string }>;
  verify(body: Buffer, signature: string): PaymentNotice;
  confirm(notice: PaymentNotice): Promise<PaymentNotice>;
}
const metadata = z.preprocess(
  (value) => {
    if (typeof value === 'string') {
      try {
        return JSON.parse(value);
      } catch {
        return null;
      }
    }
    return value;
  },
  z.object({ orderId: z.string().uuid() }),
);
const charge = z.object({
  id: z.number().int().positive().safe(),
  domain: z.literal('test'),
  status: z.literal('success'),
  reference: z.string().min(1).max(100),
  amount: z.number().int().positive().safe(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  metadata,
});
export class PaystackGateway implements PaymentGateway {
  constructor(
    private readonly secret: string,
    private readonly storefrontOrigin: string,
    private readonly currencies: readonly string[] = ['NGN'],
    private readonly transport: typeof fetch = fetch,
  ) {}
  private async request(path: string, body?: unknown): Promise<unknown> {
    try {
      const response = await this.transport(`https://api.paystack.co${path}`, {
        method: body ? 'POST' : 'GET',
        headers: {
          Authorization: `Bearer ${this.secret}`,
          'Content-Type': 'application/json',
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(8000),
        redirect: 'error',
      });
      const payload = z
        .object({ status: z.boolean(), data: z.unknown().optional() })
        .parse(await response.json());
      if (!response.ok || !payload.status)
        throw new Error('Provider rejected request');
      return payload.data;
    } catch {
      throw new AppError(
        502,
        'PAYMENT_PROVIDER_UNAVAILABLE',
        'Paystack could not complete the request. Your order remains unpaid; retry shortly.',
      );
    }
  }
  async create(order: {
    id: string;
    currency: string;
    total: number;
    email: string;
    expiresAt: Date;
  }) {
    assert(
      this.currencies.includes(order.currency),
      422,
      'PAYMENT_CURRENCY_UNSUPPORTED',
      'This currency is not enabled for your Paystack merchant account',
    );
    assert(
      order.total > 0,
      422,
      'PAYMENT_AMOUNT_UNSUPPORTED',
      'Paystack requires a positive transaction amount',
    );
    const reference = `ecom-${order.id}`;
    const data = z
      .object({
        authorization_url: z.string().url(),
        reference: z.literal(reference),
      })
      .safeParse(
        await this.request('/transaction/initialize', {
          email: order.email,
          amount: order.total,
          currency: order.currency,
          reference,
          callback_url: `${this.storefrontOrigin}/checkout/payment?order=${order.id}`,
          metadata: { orderId: order.id },
        }),
      );
    assert(
      data.success,
      502,
      'INVALID_PROVIDER_RESPONSE',
      'Paystack returned an invalid checkout response',
    );
    const initialized = data.data;
    const url = new URL(initialized.authorization_url);
    assert(
      url.protocol === 'https:' && url.hostname === 'checkout.paystack.com',
      502,
      'INVALID_CHECKOUT_URL',
      'Paystack returned an invalid checkout destination',
    );
    return { id: initialized.reference, url: initialized.authorization_url };
  }
  private notice(value: unknown): PaymentNotice {
    const data = charge.parse(value);
    assert(
      data.reference === `ecom-${data.metadata.orderId}`,
      400,
      'REFERENCE_MISMATCH',
      'Payment reference does not match order',
    );
    return {
      id: `paystack:charge:${data.id}`,
      type: 'paid',
      orderId: data.metadata.orderId,
      reference: data.reference,
      amount: data.amount,
      currency: data.currency,
      providerTransactionId: String(data.id),
    };
  }
  verify(body: Buffer, signature: string): PaymentNotice {
    if (!/^[a-f0-9]{128}$/i.test(signature))
      throw new Error('Invalid Paystack signature');
    const expected = createHmac('sha512', this.secret).update(body).digest();
    const actual = Buffer.from(signature, 'hex');
    if (actual.length !== expected.length || !timingSafeEqual(expected, actual))
      throw new Error('Invalid Paystack signature');
    const event = z
      .object({ event: z.string(), data: z.unknown() })
      .parse(JSON.parse(body.toString('utf8')));
    if (event.event !== 'charge.success')
      return { id: 'ignored', type: 'ignored' };
    return this.notice(event.data);
  }
  async confirm(notice: PaymentNotice) {
    if (notice.type === 'ignored') return notice;
    let verified: PaymentNotice;
    try {
      verified = this.notice(
        await this.request(
          `/transaction/verify/${encodeURIComponent(notice.reference!)}`,
        ),
      );
    } catch (error) {
      if (error instanceof AppError && error.status === 502) throw error;
      throw new AppError(
        502,
        'PAYMENT_VERIFICATION_UNAVAILABLE',
        'Paystack has not confirmed this transaction. The notification can be retried.',
      );
    }
    assert(
      verified.id === notice.id &&
        verified.reference === notice.reference &&
        verified.orderId === notice.orderId &&
        verified.amount === notice.amount &&
        verified.currency === notice.currency,
      502,
      'PAYMENT_VERIFICATION_MISMATCH',
      'Paystack verification does not match the signed notification',
    );
    return verified;
  }
}
