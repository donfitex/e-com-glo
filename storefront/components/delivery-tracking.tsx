import { Check, Package, Truck, ExternalLink } from 'lucide-react';
import type { Order } from '@/lib/types';

function date(value: string) {
  return new Intl.DateTimeFormat('en', {
    dateStyle: 'medium',
    timeZone: 'UTC',
  }).format(new Date(value));
}
export function DeliveryTracking({
  order,
  compact = false,
}: {
  order: Order;
  compact?: boolean;
}) {
  const delivered = order.status === 'DELIVERED';
  const cancelled = order.status === 'CANCELLED';
  const paid = order.paymentStatus === 'PAID';
  const shipped = order.status === 'SHIPPED';
  const current = delivered ? 3 : shipped ? 2 : paid ? 1 : 0;
  const steps = [
    { label: 'Order placed', at: order.createdAt },
    { label: 'Payment confirmed', at: order.paidAt },
    { label: 'Shipped', at: order.shippedAt },
    { label: 'Delivered', at: order.deliveredAt },
  ];
  const title =
    order.paymentStatus === 'REFUND_REQUIRED'
      ? 'Delivery on hold — refund review required'
      : cancelled
        ? 'Order cancelled'
        : delivered
          ? 'Delivered to your address'
          : paid
            ? shipped
              ? 'On the way — awaiting delivery'
              : 'Payment confirmed — awaiting delivery'
            : 'Awaiting payment';
  return (
    <section
      className={`delivery-tracking ${compact ? 'delivery-compact' : ''}`}
      aria-label="Order tracking"
    >
      <div className="delivery-heading">
        {delivered ? (
          <Check size={21} aria-hidden="true" />
        ) : shipped ? (
          <Truck size={21} aria-hidden="true" />
        ) : (
          <Package size={21} aria-hidden="true" />
        )}
        <div>
          <span className="eyebrow muted">DELIVERY STATUS</span>
          <h2>{title}</h2>
        </div>
      </div>
      {delivered ? (
        <p>
          {order.deliveredAt
            ? `Marked delivered on ${date(order.deliveredAt)}.`
            : 'The store has marked this order delivered.'}
        </p>
      ) : (
        !cancelled &&
        (paid && order.estimatedDeliveryTo ? (
          <p className="delivery-estimate">
            Estimated delivery{' '}
            <strong>
              {order.estimatedDeliveryFrom &&
              date(order.estimatedDeliveryFrom) !==
                date(order.estimatedDeliveryTo)
                ? `${date(order.estimatedDeliveryFrom)} – `
                : ''}
              {date(order.estimatedDeliveryTo)}
            </strong>
          </p>
        ) : (
          <p>
            {paid
              ? 'Your delivery date will be updated by the store.'
              : `Estimated shipping window: ${order.deliveryMinDays ?? 3}–${order.deliveryMaxDays ?? 7} calendar days after payment confirmation.`}
          </p>
        ))
      )}
      {!compact && !cancelled && (
        <ol className="tracking-timeline">
          {steps.map((step, index) => (
            <li
              key={step.label}
              className={index <= current ? 'tracking-complete' : ''}
              aria-current={index === current ? 'step' : undefined}
            >
              <span className="tracking-dot" aria-hidden="true">
                {index < current ? <Check size={13} /> : index + 1}
              </span>
              <div>
                <strong>{step.label}</strong>
                <small>
                  {step.at
                    ? date(step.at)
                    : index > current
                      ? 'Not yet completed'
                      : 'Completed'}
                </small>
              </div>
            </li>
          ))}
        </ol>
      )}
      {!compact && (order.carrier || order.trackingNumber) && (
        <dl className="tracking-details">
          {order.carrier && (
            <div>
              <dt>Delivery partner</dt>
              <dd>{order.carrier}</dd>
            </div>
          )}
          {order.trackingNumber && (
            <div>
              <dt>Tracking number</dt>
              <dd>{order.trackingNumber}</dd>
            </div>
          )}
        </dl>
      )}
      {!compact && order.trackingUrl?.startsWith('https://') && (
        <a
          className="button outline"
          href={order.trackingUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          Track with carrier <ExternalLink size={15} />
        </a>
      )}
      {!compact && !cancelled && !delivered && (
        <p className="tracking-note">
          {shipped
            ? 'Shipment updates are provided by the store. Use the carrier link when available.'
            : 'Your tracking details will appear here after the store prepares your shipment.'}{' '}
          Delivery dates are estimates.
        </p>
      )}
    </section>
  );
}
