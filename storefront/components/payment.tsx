'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { launchPaystack } from '@/lib/payments';
import { api, ApiError } from '@/lib/client-api';
import { money, type Order } from '@/lib/types';
export function Payment() {
  const params = useSearchParams();
  const router = useRouter();
  const id = params.get('order');
  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const returned = params.has('reference') || params.has('trxref');
  useEffect(() => {
    if (!id) return;
    let active = true;
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function refresh() {
      try {
        const next = await api<Order>(`/orders/${id}`);
        if (!active) return;
        setOrder(next);
        if (
          returned &&
          next.paymentStatus === 'UNPAID' &&
          next.status === 'PENDING' &&
          attempts++ < 12
        )
          timer = setTimeout(() => void refresh(), 5000);
      } catch (e) {
        if (e instanceof ApiError && e.status === 401 && active) {
          router.replace(
            `/login?next=${encodeURIComponent(`/checkout/payment?order=${id}`)}`,
          );
          return;
        }
        if (active)
          setError(
            e instanceof Error
              ? e.message
              : 'Could not refresh payment status.',
          );
      }
    }
    void refresh();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [id, returned, router]);
  async function refreshStatus() {
    setError('');
    try {
      setOrder(await api<Order>(`/orders/${id}`));
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        router.replace(
          `/login?next=${encodeURIComponent(`/checkout/payment?order=${id}`)}`,
        );
        return;
      }
      setError(
        e instanceof Error ? e.message : 'Could not refresh payment status.',
      );
    }
  }
  async function pay() {
    setBusy(true);
    setError('');
    try {
      await launchPaystack(id!);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        router.replace(
          `/login?next=${encodeURIComponent(`/checkout/payment?order=${id}`)}`,
        );
        return;
      }
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
            {params.has('retry') && (
              <div className="notice" role="status">
                Your order is saved. Payment could not be opened. Use the button
                below to retry.
              </div>
            )}
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
                Your Paystack checkout was cancelled. You can retry while the
                order is pending.
              </p>
            )}
            {order.paymentStatus !== 'PAID' && order.status === 'PENDING' && (
              <button
                className="button primary"
                disabled={busy}
                onClick={() => void pay()}
              >
                {busy ? 'Opening secure checkout…' : 'Continue to Paystack'}
              </button>
            )}
            <p>
              Confirmation is based on verified Paystack notifications.
              Returning to this page does not mark an order paid.
            </p>
            <button className="text-link" onClick={() => void refreshStatus()}>
              Check payment status
            </button>
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
