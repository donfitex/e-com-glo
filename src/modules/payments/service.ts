import { deliveryWindow } from '../orders/delivery';
import { z } from 'zod';
import { address } from '../../shared/validation';
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
      'Paystack test checkout is not configured yet. Your order remains unpaid.',
    );
    const gateway = this.gateway;
    // Serialize initialization per order. An existing URL is reused without another provider call.
    return this.db.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${id},0))`;
        const order = await tx.order.findFirst({
          where: { id, userId },
          include: { user: { select: { email: true } } },
        });
        assert(order, 404, 'NOT_FOUND', 'Order not found');
        assert(
          order.status === 'PENDING' && order.paymentStatus === 'UNPAID',
          409,
          'ORDER_NOT_PAYABLE',
          'This order cannot accept a payment',
        );
        assert(
          order.expiresAt.getTime() > Date.now(),
          409,
          'PAYMENT_WINDOW_CLOSED',
          'This order reservation has expired',
        );
        assert(
          !order.paymentProvider || order.paymentProvider === 'paystack',
          409,
          'LEGACY_PAYMENT_ORDER',
          'This order belongs to the previous payment provider. Create a new order.',
        );
        if (order.paymentReference && order.paymentAuthorizationUrl)
          return { url: order.paymentAuthorizationUrl };
        const contact = z
          .object({ email: address.shape.email })
          .safeParse(order.shippingAddress);
        const session = await gateway.create({
          ...order,
          email: contact.success ? contact.data.email : order.user.email,
        });
        const changed = await tx.order.updateMany({
          where: {
            id,
            status: 'PENDING',
            paymentStatus: 'UNPAID',
            expiresAt: { gt: new Date() },
          },
          data: {
            paymentReference: session.id,
            paymentAuthorizationUrl: session.url,
            paymentProvider: 'paystack',
          },
        });
        assert(
          changed.count === 1,
          409,
          'ORDER_CHANGED',
          'Order changed or expired before payment initialization completed',
        );
        return { url: session.url };
      },
      { isolationLevel: 'ReadCommitted', timeout: 12000, maxWait: 12000 },
    );
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
    if (await this.db.paymentEvent.findUnique({ where: { id: notice.id } }))
      return;
    notice = await this.gateway.confirm(notice);
    try {
      await serializable(this.db, async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${notice.orderId},0))`;
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
          !order.paymentReference ||
            order.paymentReference === notice.reference,
          400,
          'REFERENCE_MISMATCH',
          'Payment reference does not match order',
        );
        assert(
          !order.paymentProvider || order.paymentProvider === 'paystack',
          400,
          'PROVIDER_MISMATCH',
          'Payment provider does not match order',
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
            const paidAt = new Date();
            await tx.order.update({
              where: { id: order.id },
              data: {
                paymentStatus: cancelled ? 'REFUND_REQUIRED' : 'PAID',
                ...(!cancelled
                  ? {
                      status: 'CONFIRMED',
                      ...deliveryWindow(
                        paidAt,
                        order.deliveryMinDays,
                        order.deliveryMaxDays,
                      ),
                    }
                  : {}),
                paidAt,
                paymentReference: notice.reference,
                paymentProvider: 'paystack',
                providerTransactionId: notice.providerTransactionId,
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
        }
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
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${candidate.id},0))`;
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
