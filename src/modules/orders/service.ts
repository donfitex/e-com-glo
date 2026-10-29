import { OrderStatus, Prisma } from '@prisma/client';
import { Database, serializable } from '../../infrastructure/database';
import { PricingService } from '../cart/pricing';
import { AppError, assert } from '../../shared/errors';
import { Address } from '../../shared/validation';
import { Cache } from '../../infrastructure/cache';
const transitions: Record<OrderStatus, OrderStatus[]> = {
  PENDING: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['SHIPPED', 'CANCELLED'],
  SHIPPED: ['DELIVERED'],
  DELIVERED: [],
  CANCELLED: [],
};
export class OrderService {
  constructor(
    private readonly db: Database,
    private readonly pricing: PricingService,
    private readonly cache: Cache,
  ) {}
  async checkout(userId: string, key: string, shippingAddress: Address) {
    const execute = () =>
      serializable(this.db, async (tx) => {
        const existing = await tx.order.findUnique({
          where: { userId_idempotencyKey: { userId, idempotencyKey: key } },
          include: { items: true },
        });
        if (existing) {
          const canonical = (v: unknown): string =>
            JSON.stringify(
              Object.entries(v as Record<string, unknown>).sort(([a], [b]) =>
                a.localeCompare(b),
              ),
            );
          assert(
            canonical(existing.shippingAddress) === canonical(shippingAddress),
            409,
            'IDEMPOTENCY_CONFLICT',
            'This key was already used with another address',
          );
          return existing;
        }
        const cart = await tx.cart.findUnique({
          where: { userId },
          include: {
            items: {
              include: { product: true },
              orderBy: { productId: 'asc' },
            },
          },
        });
        assert(cart?.items.length, 409, 'EMPTY_CART', 'Cart is empty');
        const quote = this.pricing.calculate(cart.items);
        for (const item of cart.items) {
          const result = await tx.product.updateMany({
            where: {
              id: item.productId,
              active: true,
              stock: { gte: item.quantity },
            },
            data: { stock: { decrement: item.quantity } },
          });
          assert(
            result.count === 1,
            409,
            'INSUFFICIENT_STOCK',
            'Stock changed during checkout',
          );
        }
        const order = await tx.order.create({
          data: {
            userId,
            idempotencyKey: key,
            shippingAddress,
            currency: quote.currency!,
            total: quote.total,
            items: {
              create: quote.items.map(({ lineTotal: _, ...line }) => {
                void _;
                return line;
              }),
            },
          },
          include: { items: true },
        });
        await tx.cartItem.deleteMany({ where: { cartId: cart.id } });
        await tx.auditEvent.create({
          data: {
            actorId: userId,
            action: 'order.created',
            entityId: order.id,
          },
        });
        return order;
      });
    let result;
    try {
      result = await execute();
    } catch (e) {
      // A concurrent identical request can lose the unique-key race after the first commits.
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      )
        result = await execute();
      else throw e;
    }
    await this.cache.invalidate();
    return result;
  }
  async list(
    userId: string | undefined,
    page: number,
    limit: number,
    status?: OrderStatus,
  ) {
    const where = { userId, status };
    const [items, total] = await Promise.all([
      this.db.order.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.db.order.count({ where }),
    ]);
    return { items, total, page, limit };
  }
  async detail(userId: string, id: string) {
    const order = await this.db.order.findFirst({
      where: { id, userId },
      include: { items: true },
    });
    assert(order, 404, 'NOT_FOUND', 'Order not found');
    return order;
  }
  async transition(actorId: string, id: string, status: OrderStatus) {
    const order = await serializable(this.db, async (tx) => {
      const order = await tx.order.findUnique({
        where: { id },
        include: { items: true },
      });
      assert(order, 404, 'NOT_FOUND', 'Order not found');
      if (!transitions[order.status].includes(status))
        throw new AppError(
          409,
          'INVALID_TRANSITION',
          `Cannot transition ${order.status} to ${status}`,
        );
      if (status === 'CANCELLED')
        for (const item of [...order.items].sort((a, b) =>
          a.productId.localeCompare(b.productId),
        ))
          await tx.product.update({
            where: { id: item.productId },
            data: { stock: { increment: item.quantity } },
          });
      const updated = await tx.order.update({
        where: { id },
        data: { status },
      });
      await tx.auditEvent.create({
        data: {
          actorId,
          action: 'order.status_changed',
          entityId: id,
          metadata: { from: order.status, to: status },
        },
      });
      return updated;
    });
    await this.cache.invalidate();
    return order;
  }
}
