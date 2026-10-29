import { Prisma } from '@prisma/client';
import { Database, serializable } from '../../infrastructure/database';
import { Cache } from '../../infrastructure/cache';
import { assert, AppError } from '../../shared/errors';
import { PaymentGateway } from './gateway';
export class PaymentService {
  constructor(
    private readonly db: Database,
    private readonly cache: Cache,
    private readonly gateway?: PaymentGateway,
  ) {}
  async start(userId: string, id: string) {
    assert(
      this.gateway,
      503,
      'PAYMENTS_UNAVAILABLE',
      'Stripe test checkout is not configured yet. Your order remains unpaid.',
    );
    const order = await this.db.order.findFirst({ where: { id, userId } });
    assert(order, 404, 'NOT_FOUND', 'Order not found');
    assert(
      order.status === 'PENDING' && order.paymentStatus === 'UNPAID',
      409,
      'ORDER_NOT_PAYABLE',
      'This order cannot accept a payment',
    );
    assert(
      order.expiresAt.getTime() > Date.now() + 30 * 60 * 1000,
      409,
      'PAYMENT_WINDOW_CLOSED',
      'The payment window has closed. Wait for this reservation to expire before reordering.',
    );
    const session = await this.gateway.create(order);
    const result = await this.db.order.updateMany({
      where: {
        id,
        userId,
        status: 'PENDING',
        paymentStatus: 'UNPAID',
        expiresAt: { gt: new Date() },
      },
      data: { stripeSessionId: session.id },
    });
    if (!result.count) {
      await this.gateway.expire(session.id).catch(() => {});
      throw new AppError(
        409,
        'ORDER_CHANGED',
        'Order changed before payment. Check its current status.',
      );
    }
    return { url: session.url };
  }
  async webhook(body: Buffer, signature: string) {
    assert(
      this.gateway,
      503,
      'PAYMENTS_UNAVAILABLE',
      'Payment notifications are not configured',
    );
    let notice;
    try {
      notice = this.gateway.verify(body, signature);
    } catch {
      throw new AppError(
        400,
        'INVALID_SIGNATURE',
        'Invalid payment notification',
      );
    }
    if (notice.type === 'ignored') return;
    try {
      await serializable(this.db, async (tx) => {
        if (await tx.paymentEvent.findUnique({ where: { id: notice.id } }))
          return;
        const order = await tx.order.findUnique({
          where: {
            id: notice.orderId ?? '00000000-0000-0000-0000-000000000000',
          },
          include: { items: true },
        });
        assert(
          order,
          400,
          'UNKNOWN_ORDER',
          'Payment notification references an unknown order',
        );
        assert(
          !order.stripeSessionId || order.stripeSessionId === notice.sessionId,
          400,
          'SESSION_MISMATCH',
          'Payment session does not match order',
        );
        if (notice.type === 'paid') {
          assert(
            notice.amount === order.total && notice.currency === order.currency,
            400,
            'PAYMENT_MISMATCH',
            'Payment amount or currency does not match order',
          );
          if (order.paymentStatus !== 'PAID') {
            const cancelled = order.status === 'CANCELLED';
            await tx.order.update({
              where: { id: order.id },
              data: {
                paymentStatus: cancelled ? 'REFUND_REQUIRED' : 'PAID',
                ...(!cancelled ? { status: 'CONFIRMED' } : {}),
                stripeSessionId: notice.sessionId,
                paymentIntentId: notice.paymentIntentId,
              },
            });
            await tx.auditEvent.create({
              data: {
                action: cancelled
                  ? 'payment.refund_required'
                  : 'payment.confirmed',
                entityId: order.id,
              },
            });
          }
        } else if (
          order.paymentStatus === 'UNPAID' &&
          order.status === 'PENDING'
        )
          await this.release(tx, order);
        await tx.paymentEvent.create({
          data: { id: notice.id, orderId: order.id, kind: notice.type },
        });
      });
    } catch (e) {
      if (!(
        e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002'
      ))
        throw e;
    }
    await this.cache.invalidate();
  }
  private async release(
    tx: Prisma.TransactionClient,
    order: { id: string; items: { productId: string; quantity: number }[] },
  ) {
    for (const item of [...order.items].sort((a, b) =>
      a.productId.localeCompare(b.productId),
    ))
      await tx.product.update({
        where: { id: item.productId },
        data: { stock: { increment: item.quantity } },
      });
    await tx.order.update({
      where: { id: order.id },
      data: { status: 'CANCELLED', paymentStatus: 'EXPIRED' },
    });
    await tx.auditEvent.create({
      data: { action: 'order.reservation_expired', entityId: order.id },
    });
  }
  async expireUnpaid() {
    const orders = await this.db.order.findMany({
      where: {
        status: 'PENDING',
        paymentStatus: 'UNPAID',
        expiresAt: { lte: new Date() },
      },
      select: { id: true },
      take: 100,
      orderBy: { expiresAt: 'asc' },
    });
    for (const candidate of orders)
      await serializable(this.db, async (tx) => {
        const order = await tx.order.findUnique({
          where: { id: candidate.id },
          include: { items: true },
        });
        if (
          order?.status === 'PENDING' &&
          order.paymentStatus === 'UNPAID' &&
          order.expiresAt <= new Date()
        )
          await this.release(tx, order);
      });
    if (orders.length) await this.cache.invalidate();
  }
}
