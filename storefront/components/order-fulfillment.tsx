'use client';
import type { FormEvent } from 'react';
import { api } from '@/lib/client-api';
import type { Order } from '@/lib/types';
import { DeliveryTracking } from './delivery-tracking';

type Mutate = (
  action: () => Promise<unknown>,
  success: string,
) => Promise<boolean>;
export function OrderFulfillment({
  order,
  busy,
  mutate,
}: {
  order: Order;
  busy: boolean;
  mutate: Mutate;
}) {
  const editable =
    order.paymentStatus === 'PAID' &&
    ['CONFIRMED', 'SHIPPED'].includes(order.status);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const date = String(values.get('expectedDeliveryDate') ?? '');
    await mutate(
      () =>
        api(`/admin/orders/${order.id}/shipment`, {
          method: 'PATCH',
          body: JSON.stringify({
            carrier: String(values.get('carrier')).trim() || null,
            trackingNumber: String(values.get('trackingNumber')).trim() || null,
            trackingUrl: String(values.get('trackingUrl')).trim() || null,
            ...(date ? { expectedDeliveryDate: date } : {}),
          }),
        }),
      'Shipment details updated. The customer can see these changes.',
    );
  }
  function transition(status: string) {
    void mutate(
      () =>
        api(`/admin/orders/${order.id}/status`, {
          method: 'PATCH',
          body: JSON.stringify({ status }),
        }),
      status === 'DELIVERED'
        ? 'Order marked delivered. The customer’s tracking has been updated.'
        : 'Order status updated.',
    );
  }
  return (
    <div className="order-fulfillment">
      <DeliveryTracking order={order} compact />
      {editable && (
        <form
          className="shipment-editor"
          aria-label={`Shipment for order ${order.id.slice(0, 8)}`}
          onSubmit={save}
        >
          <label>
            Delivery partner
            <input
              name="carrier"
              maxLength={120}
              defaultValue={order.carrier ?? ''}
              placeholder="e.g. DHL, local courier"
            />
          </label>
          <label>
            Tracking number
            <input
              name="trackingNumber"
              maxLength={100}
              defaultValue={order.trackingNumber ?? ''}
            />
          </label>
          <label>
            Carrier tracking link
            <input
              name="trackingUrl"
              type="url"
              maxLength={1000}
              placeholder="https://…"
              defaultValue={order.trackingUrl ?? ''}
            />
          </label>
          <label>
            Expected delivery date
            <input
              name="expectedDeliveryDate"
              type="date"
              defaultValue={order.estimatedDeliveryTo?.slice(0, 10) ?? ''}
            />
          </label>
          <button className="button outline" disabled={busy}>
            Save shipment details
          </button>
        </form>
      )}
      <div className="inline-actions">
        {editable && order.status === 'CONFIRMED' && (
          <button
            className="button primary"
            disabled={busy}
            onClick={() => transition('SHIPPED')}
          >
            Mark as shipped
          </button>
        )}
        {editable && order.status === 'SHIPPED' && (
          <button
            className="button primary"
            disabled={busy}
            onClick={() => transition('DELIVERED')}
          >
            Mark as delivered
          </button>
        )}
        {order.status === 'PENDING' && order.paymentStatus === 'UNPAID' && (
          <button
            className="button outline"
            disabled={busy}
            onClick={() => transition('CANCELLED')}
          >
            Cancel unpaid order
          </button>
        )}
      </div>
    </div>
  );
}
