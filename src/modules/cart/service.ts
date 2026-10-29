import { Database, serializable } from '../../infrastructure/database';
import { assert } from '../../shared/errors';
import { PricingService } from './pricing';
export class CartService {
  constructor(
    private readonly db: Database,
    private readonly pricing: PricingService,
  ) {}
  async view(userId: string) {
    const cart = await this.db.cart.findUnique({
      where: { userId },
      include: {
        items: { include: { product: true }, orderBy: { productId: 'asc' } },
      },
    });
    return this.pricing.calculate(cart?.items ?? []);
  }
  async set(userId: string, productId: string, quantity: number) {
    await serializable(this.db, async (tx) => {
      const cart = await tx.cart.upsert({
        where: { userId },
        create: { userId },
        update: {},
      });
      const items = await tx.cartItem.findMany({
        where: { cartId: cart.id },
        include: { product: true },
      });
      assert(
        items.some((i) => i.productId === productId) || items.length < 100,
        409,
        'CART_FULL',
        'Cart supports at most 100 distinct products',
      );
      const product = await tx.product.findUnique({ where: { id: productId } });
      assert(product, 404, 'NOT_FOUND', 'Product not found');
      this.pricing.calculate([
        ...items.filter((i) => i.productId !== productId),
        { quantity, product },
      ]);
      await tx.cartItem.upsert({
        where: { cartId_productId: { cartId: cart.id, productId } },
        create: { cartId: cart.id, productId, quantity },
        update: { quantity },
      });
    });
    return this.view(userId);
  }
  async remove(userId: string, productId?: string) {
    await this.db.cartItem.deleteMany({
      where: { cart: { userId }, ...(productId ? { productId } : {}) },
    });
  }
}
