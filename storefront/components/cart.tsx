'use client';
import Link from 'next/link';
import { useState, useEffect, useCallback } from 'react';
import { Trash2, ArrowRight, ShoppingBag } from 'lucide-react';
import { api, announceCart } from '@/lib/client-api';
import { useSession } from './session';
import type { Cart as CartData } from '@/lib/types';
import { money } from '@/lib/types';
export function Cart() {
  const { user, loading: sessionLoading } = useSession();
  const [cart, setCart] = useState<CartData | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    try {
      setCart(await api<CartData>('/cart'));
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load bag.');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    if (user) void load();
  }, [user, load]);
  async function change(id: string, quantity: number) {
    setBusy(true);
    try {
      await api(`/cart/items/${id}`, {
        method: quantity ? 'PATCH' : 'DELETE',
        ...(quantity ? { body: JSON.stringify({ quantity }) } : {}),
      });
      await load();
      announceCart();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update bag.');
    } finally {
      setBusy(false);
    }
  }
  if (sessionLoading) return <div className="shell page">Loading…</div>;
  if (!user)
    return (
      <div className="shell page empty-state">
        <ShoppingBag />
        <h1>Your next favorites belong here.</h1>
        <p>Sign in to start your shopping bag.</p>
        <Link className="button primary" href="/login?next=/cart">
          Sign in
        </Link>
      </div>
    );
  return (
    <div className="shell page">
      <div className="page-heading">
        <span className="eyebrow muted">A FEW GOOD FINDS</span>
        <h1>Your shopping bag.</h1>
      </div>
      {error && (
        <div className="notice error" role="alert">
          {error}
          <button className="text-link" onClick={() => void load()}>
            Retry
          </button>
          {!cart && (
            <button
              className="text-link"
              onClick={async () => {
                await api('/cart', { method: 'DELETE' });
                announceCart();
                await load();
              }}
            >
              Clear unavailable bag
            </button>
          )}
        </div>
      )}
      {loading ? (
        <p>Loading your bag…</p>
      ) : !cart?.items.length ? (
        <div className="empty-state">
          <h2>A little room for possibility.</h2>
          <p>Your bag is empty. Let’s find something you’ll love.</p>
          <Link className="button primary" href="/shop">
            Explore the collection <ArrowRight size={18} />
          </Link>
        </div>
      ) : (
        <div className="cart-layout">
          <div>
            {cart.items.map((item) => (
              <article className="cart-line" key={item.productId}>
                <div className="cart-line-icon">
                  <ShoppingBag size={32} />
                </div>
                <div>
                  <Link href={`/products/${item.productId}`}>
                    <h2>{item.name}</h2>
                  </Link>
                  <span className="muted">{item.sku}</span>
                  <p>{money(item.price, cart.currency!)}</p>
                </div>
                <label className="quantity-label">
                  Quantity
                  <input
                    aria-label={`Quantity for ${item.name}`}
                    type="number"
                    min={1}
                    max={100}
                    value={item.quantity}
                    disabled={busy}
                    onChange={(e) => {
                      const value = Number(e.target.value);
                      if (Number.isInteger(value) && value > 0 && value <= 100)
                        void change(item.productId, value);
                    }}
                  />
                </label>
                <strong>{money(item.lineTotal, cart.currency!)}</strong>
                <button
                  aria-label={`Remove ${item.name}`}
                  className="icon-button"
                  disabled={busy}
                  onClick={() => void change(item.productId, 0)}
                >
                  <Trash2 size={18} />
                </button>
              </article>
            ))}
            <Link className="text-link" href="/shop">
              ← Keep exploring
            </Link>
          </div>
          <aside className="summary-card">
            <span className="eyebrow muted">THE GOOD FINDS, TOGETHER</span>
            <h2>Order summary</h2>
            <div className="summary-row">
              <span>Subtotal</span>
              <strong>{money(cart.subtotal, cart.currency!)}</strong>
            </div>
            <p className="muted">
              Delivery and tax are calculated from your shipping address at
              checkout.
            </p>
            <div className="summary-total">
              <span>Subtotal · {cart.currency}</span>
              <strong>{money(cart.total, cart.currency!)}</strong>
            </div>
            <Link className="button primary" href="/checkout">
              Continue to checkout <ArrowRight size={17} />
            </Link>
            <small>
              All items in your bag use {cart.currency}. Prices are rechecked
              before you order.
            </small>
          </aside>
        </div>
      )}
    </div>
  );
}
