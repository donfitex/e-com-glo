import { recordOrderEvent } from '../events/outbox';
import { deliveryWindow, ShipmentInput } from './delivery';
import { CheckoutPolicy } from '../checkout/policy';
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
    private readonly policy: CheckoutPolicy,
  ) {}
  async quote(userId: string, shippingAddress: Address) {
    const cart = await this.db.cart.findUnique({
      where: { userId },
      include: { items: { include: { product: true } } },
    });
    assert(cart?.items.length, 409, 'EMPTY_CART', 'Cart is empty');
    const subtotal = this.pricing.calculate(cart.items);
    return this.policy.quote(
      subtotal.total,
      subtotal.currency!,
      shippingAddress.country,
    );
  }
  async checkout(
    userId: string,
    key: string,
    shippingAddress: Address,
    expected?: { total: number; ruleVersion: string },
  ) {
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
        const totals = this.policy.quote(
          quote.total,
          quote.currency!,
          shippingAddress.country,
        );
        if (expected)
          assert(
            expected.total === totals.total &&
              expected.ruleVersion === totals.ruleVersion,
            409,
            'QUOTE_CHANGED',
            'Prices or delivery rules changed. Review the updated quote.',
          );
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
        const paidAt = totals.total === 0 ? new Date() : null;
        const order = await tx.order.create({
          data: {
            userId,
            idempotencyKey: key,
            shippingAddress,
            currency: quote.currency!,
            total: totals.total,
            ...(totals.total === 0
              ? {
                  paymentStatus: 'PAID',
                  status: 'CONFIRMED',
                  paymentProvider: 'free',
                }
              : {}),
            subtotal: totals.subtotal,
            shipping: totals.shipping,
            tax: totals.tax,
            ruleVersion: totals.ruleVersion,
            deliveryMinDays: totals.deliveryMinDays,
            deliveryMaxDays: totals.deliveryMaxDays,
            ...(paidAt
              ? {
                  paidAt,
                  ...deliveryWindow(
                    paidAt,
                    totals.deliveryMinDays,
                    totals.deliveryMaxDays,
                  ),
                }
              : {}),
            items: {
              create: quote.items.map(({ lineTotal: _, ...line }) => {
                void _;
                return line;
              }),
            },
          },
          include: { items: true },
        });
        await recordOrderEvent(tx, order.id, 'OrderCreated');
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
  async updateShipment(actorId: string, id: string, input: ShipmentInput) {
    return serializable(this.db, async (tx) => {
      const order = await tx.order.findUnique({ where: { id } });
      assert(order, 404, 'NOT_FOUND', 'Order not found');
      assert(
        order.paymentStatus === 'PAID' &&
          ['CONFIRMED', 'SHIPPED'].includes(order.status),
        409,
        'SHIPMENT_NOT_EDITABLE',
        'Shipment updates require a paid order awaiting delivery',
      );
      const { expectedDeliveryDate, ...tracking } = input;
      let dates = {};
      if (expectedDeliveryDate) {
        const date = new Date(`${expectedDeliveryDate}T00:00:00.000Z`);
        const today = new Date();
        today.setUTCHours(0, 0, 0, 0);
        assert(
          date >= today,
          422,
          'INVALID_DELIVERY_DATE',
          'Expected delivery date cannot be in the past',
        );
        dates = { estimatedDeliveryFrom: date, estimatedDeliveryTo: date };
      }
      const saved = await tx.order.update({
        where: { id },
        data: { ...tracking, ...dates },
      });
      await tx.auditEvent.create({
        data: { actorId, action: 'order.shipment_updated', entityId: id },
      });
      return saved;
    });
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
      assert(
        (order.paymentStatus !== 'PAID' &&
          order.paymentStatus !== 'REFUND_REQUIRED') ||
          status !== 'CANCELLED',
        409,
        'REFUND_REQUIRED',
        'Paid orders require a verified refund before cancellation',
      );
      if (['CONFIRMED', 'SHIPPED', 'DELIVERED'].includes(status))
        assert(
          order.paymentStatus === 'PAID',
          409,
          'PAYMENT_REQUIRED',
          'Payment must be verified before fulfillment',
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
        data: {
          status,
          ...(status === 'SHIPPED' ? { shippedAt: new Date() } : {}),
          ...(status === 'DELIVERED' ? { deliveredAt: new Date() } : {}),
        },
      });
      if (status === 'SHIPPED') await recordOrderEvent(tx, id, 'OrderShipped');
      if (status === 'DELIVERED')
        await recordOrderEvent(tx, id, 'OrderDelivered');
      if (status === 'CANCELLED')
        await recordOrderEvent(tx, id, 'OrderCancelled');
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
