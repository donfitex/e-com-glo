'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { api } from '@/lib/client-api';
import { money, type Order } from '@/lib/types';
export function Payment() {
  const params = useSearchParams();
  const id = params.get('order');
  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (id)
      api<Order>(`/orders/${id}`)
        .then(setOrder)
        .catch((e) => setError(e.message));
  }, [id]);
  async function pay() {
    setBusy(true);
    setError('');
    try {
      const { url } = await api<{ url: string }>(`/orders/${id}/payment`, {
        method: 'POST',
        body: '{}',
      });
      const target = new URL(url);
      if (
        target.protocol !== 'https:' ||
        target.hostname !== 'checkout.stripe.com'
      )
        throw new Error('Invalid payment destination');
      window.location.assign(target.href);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start payment.');
      setBusy(false);
    }
  }
  return (
    <div className="shell page payment-page">
      <div className="form-card">
        <span className="eyebrow muted">YOUR ORDER, ONE STEP CLOSER</span>
        <h1>
          {order?.paymentStatus === 'PAID'
            ? 'Payment confirmed.'
            : 'Complete your payment.'}
        </h1>
        {order ? (
          <>
            <p>Order #{order.id.slice(0, 8).toUpperCase()}</p>
            <div className="summary-total">
              <span>Total</span>
              <strong>{money(order.total, order.currency)}</strong>
            </div>
            <p>
              Status: <strong>{order.paymentStatus}</strong>
            </p>
            {params.get('cancelled') && (
              <p>
                Your Stripe checkout was cancelled. You can retry while the
                order is pending.
              </p>
            )}
            {order.paymentStatus !== 'PAID' && order.status === 'PENDING' && (
              <button
                className="button primary"
                disabled={busy}
                onClick={() => void pay()}
              >
                {busy ? 'Opening secure checkout…' : 'Continue to Stripe'}
              </button>
            )}
            <p>
              Confirmation is based on verified Stripe notifications. Returning
              to this page does not mark an order paid.
            </p>
            <Link className="text-link" href={`/account/orders/${order.id}`}>
              View your order →
            </Link>
          </>
        ) : (
          <p>{id ? 'Loading your order…' : 'No order was selected.'}</p>
        )}
        {error && (
          <div className="notice error" role="alert">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
