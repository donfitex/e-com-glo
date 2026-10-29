import { createHash } from 'node:crypto';
import { z } from 'zod';
import { assert } from '../../shared/errors';
import { currency } from '../../shared/validation';
export const checkoutRules = z
  .array(
    z
      .object({
        country: z.string().regex(/^[A-Z]{2}$/),
        currency,
        shipping: z.number().int().min(0).max(100000000),
        taxBasisPoints: z.number().int().min(0).max(10000),
        freeShippingAbove: z.number().int().min(0).optional(),
      })
      .strict(),
  )
  .max(300)
  .refine(
    (rules) =>
      new Set(rules.map((r) => `${r.country}:${r.currency}`)).size ===
      rules.length,
    { message: 'Duplicate destination/currency rules' },
  );
export type CheckoutRules = z.infer<typeof checkoutRules>;
export class CheckoutPolicy {
  readonly version: string;
  constructor(private readonly rules: CheckoutRules) {
    this.version = createHash('sha256')
      .update(JSON.stringify(rules))
      .digest('hex')
      .slice(0, 16);
  }
  quote(subtotal: number, currency: string, country: string) {
    const rule = this.rules.find(
      (rule) => rule.country === country && rule.currency === currency,
    );
    assert(
      rule,
      422,
      'DESTINATION_UNAVAILABLE',
      'Delivery is not configured for this destination and currency',
    );
    const shipping =
      rule.freeShippingAbove !== undefined && subtotal >= rule.freeShippingAbove
        ? 0
        : rule.shipping;
    // First-release policy: tax is exclusive, charged on merchandise only; round once per order.
    const tax = Math.floor((subtotal * rule.taxBasisPoints + 5000) / 10000);
    const total = subtotal + shipping + tax;
    assert(
      Number.isSafeInteger(total) && total <= 2147483647,
      409,
      'TOTAL_TOO_LARGE',
      'Order total exceeds the supported limit',
    );
    return {
      currency,
      subtotal,
      shipping,
      tax,
      total,
      ruleVersion: this.version,
    };
  }
}
