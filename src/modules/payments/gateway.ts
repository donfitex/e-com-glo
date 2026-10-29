import Stripe from 'stripe';
export interface PaymentNotice {
  id: string;
  type: 'paid' | 'expired' | 'ignored';
  orderId?: string;
  sessionId?: string;
  amount?: number;
  currency?: string;
  paymentIntentId?: string;
}
export interface PaymentGateway {
  create(order: {
    id: string;
    currency: string;
    total: number;
    expiresAt: Date;
  }): Promise<{ id: string; url: string }>;
  expire(sessionId: string): Promise<void>;
  verify(body: Buffer, signature: string): PaymentNotice;
}
export class StripeGateway implements PaymentGateway {
  private readonly stripe: Stripe;
  constructor(
    secret: string,
    private readonly webhookSecret: string,
    private readonly storefrontOrigin: string,
  ) {
    this.stripe = new Stripe(secret, { maxNetworkRetries: 2, timeout: 10000 });
  }
  async create(order: {
    id: string;
    currency: string;
    total: number;
    expiresAt: Date;
  }) {
    const session = await this.stripe.checkout.sessions.create(
      {
        mode: 'payment',
        client_reference_id: order.id,
        metadata: { orderId: order.id },
        success_url: `${this.storefrontOrigin}/checkout/payment?order=${order.id}`,
        cancel_url: `${this.storefrontOrigin}/checkout/payment?order=${order.id}&cancelled=1`,
        expires_at: Math.floor(order.expiresAt.getTime() / 1000),
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: order.currency.toLowerCase(),
              unit_amount: order.total,
              product_data: {
                name: `E-com Global order ${order.id.slice(0, 8).toUpperCase()}`,
              },
            },
          },
        ],
      },
      { idempotencyKey: `ecom-order-${order.id}` },
    );
    if (!session.url) throw new Error('Missing checkout URL');
    return { id: session.id, url: session.url };
  }
  async expire(sessionId: string) {
    await this.stripe.checkout.sessions.expire(sessionId);
  }
  verify(body: Buffer, signature: string): PaymentNotice {
    const event = this.stripe.webhooks.constructEvent(
      body,
      signature,
      this.webhookSecret,
    );
    if (event.livemode) throw new Error('Live payments are disabled');
    if (
      ![
        'checkout.session.completed',
        'checkout.session.async_payment_succeeded',
        'checkout.session.expired',
      ].includes(event.type)
    )
      return { id: event.id, type: 'ignored' };
    const session = event.data.object as Stripe.Checkout.Session;
    return {
      id: event.id,
      type:
        event.type === 'checkout.session.expired'
          ? 'expired'
          : session.payment_status === 'paid'
            ? 'paid'
            : 'ignored',
      orderId: session.client_reference_id ?? undefined,
      sessionId: session.id,
      amount: session.amount_total ?? undefined,
      currency: session.currency?.toUpperCase(),
      paymentIntentId:
        typeof session.payment_intent === 'string'
          ? session.payment_intent
          : undefined,
    };
  }
}
