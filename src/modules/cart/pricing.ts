import { Product } from '@prisma/client';
import { assert } from '../../shared/errors';
export type CartLine = { quantity: number; product: Product };
export class PricingService {
  calculate(items: CartLine[]) {
    let total = 0;
    const currency = items[0]?.product.currency ?? null;
    for (const { quantity, product } of items) {
      assert(
        product.active,
        409,
        'PRODUCT_UNAVAILABLE',
        'A product is no longer available',
      );
      assert(
        Number.isInteger(quantity) && quantity > 0 && quantity <= 100,
        409,
        'INVALID_QUANTITY',
        'Invalid cart quantity',
      );
      assert(
        product.stock >= quantity,
        409,
        'INSUFFICIENT_STOCK',
        `Insufficient stock for ${product.sku}`,
      );
      assert(
        product.currency === currency,
        409,
        'MIXED_CURRENCIES',
        'All items must use the same currency',
      );
      total += product.price * quantity;
      assert(
        Number.isSafeInteger(total) && total <= 2147483647,
        409,
        'TOTAL_TOO_LARGE',
        'Order total exceeds the supported limit',
      );
    }
    return {
      items: items.map(({ quantity, product }) => ({
        productId: product.id,
        sku: product.sku,
        name: product.name,
        price: product.price,
        quantity,
        lineTotal: product.price * quantity,
      })),
      currency,
      subtotal: total,
      total,
    };
  }
}
