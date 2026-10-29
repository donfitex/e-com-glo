'use client';
import { useState, useRef, useEffect, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { LockKeyhole, ArrowRight } from 'lucide-react';
import { api, announceCart } from '@/lib/client-api';
import { useSession } from './session';
import {
  money,
  type Cart,
  type Address,
  type Quote,
  type Order,
} from '@/lib/types';
export function Checkout() {
  const { user, loading } = useSession();
  const router = useRouter();
  const [cart, setCart] = useState<Cart | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [address, setAddress] = useState<Address | null>(null);
  const key = useRef<string | null>(null);
  const revision = useRef(0);
  useEffect(() => {
    if (user)
      api<Cart>('/cart')
        .then(setCart)
        .catch((e) => setError(e.message));
  }, [user]);
  async function preview(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const startedAtRevision = revision.current;
    const body = Object.fromEntries(
      new FormData(e.currentTarget),
    ) as unknown as Address;
    body.country = body.country.toUpperCase();
    try {
      const result = await api<Quote>('/orders/quote', {
        method: 'POST',
        body: JSON.stringify({ shippingAddress: body }),
      });
      if (startedAtRevision !== revision.current) return;
      setAddress(body);
      setQuote(result);
      key.current = crypto.randomUUID();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Could not calculate delivery.',
      );
    } finally {
      setBusy(false);
    }
  }
  async function place() {
    if (!address || !quote) return;
    setBusy(true);
    setError('');
    try {
      const order = await api<Order>('/orders/checkout', {
        method: 'POST',
        headers: { 'Idempotency-Key': key.current! },
        body: JSON.stringify({
          shippingAddress: address,
          quote: { total: quote.total, ruleVersion: quote.ruleVersion },
        }),
      });
      announceCart();
      router.push(`/checkout/payment?order=${order.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not place order.');
    } finally {
      setBusy(false);
    }
  }
  if (loading) return <div className="shell page">Loading…</div>;
  if (!user)
    return (
      <div className="shell page empty-state">
        <h1>Almost there.</h1>
        <Link className="button primary" href="/login?next=/checkout">
          Sign in to checkout
        </Link>
      </div>
    );
  return (
    <div className="shell page">
      <div className="breadcrumb">
        <Link href="/cart">Your bag</Link> / Checkout
      </div>
      <div className="page-heading">
        <span className="eyebrow muted">THE LAST LITTLE DETAILS</span>
        <h1>Make it yours.</h1>
        <p>Review delivery and tax before placing your order.</p>
      </div>
      {error && (
        <div className="notice error" role="alert">
          {error}
        </div>
      )}
      {cart && !cart.items.length ? (
        <div className="empty-state">
          <p>Your bag is empty.</p>
          <Link href="/shop" className="button primary">
            Explore the collection
          </Link>
        </div>
      ) : (
        <div className="cart-layout">
          <form
            className="form-card shipping-form"
            onSubmit={preview}
            onChange={() => {
              revision.current++;
              setQuote(null);
              setAddress(null);
              key.current = null;
            }}
          >
            <h2>Shipping address</h2>
            <label>
              Full name
              <input
                name="name"
                required
                defaultValue={user.name}
                maxLength={120}
                autoComplete="shipping name"
              />
            </label>
            <label>
              Address line 1
              <input
                name="line1"
                required
                maxLength={200}
                autoComplete="shipping address-line1"
              />
            </label>
            <label>
              Address line 2 (optional)
              <input
                name="line2"
                maxLength={200}
                autoComplete="shipping address-line2"
              />
            </label>
            <div className="form-columns">
              <label>
                City
                <input
                  name="city"
                  required
                  maxLength={100}
                  autoComplete="shipping address-level2"
                />
              </label>
              <label>
                State / region
                <input
                  name="region"
                  maxLength={100}
                  autoComplete="shipping address-level1"
                />
              </label>
            </div>
            <div className="form-columns">
              <label>
                Postal code
                <input
                  name="postalCode"
                  required
                  maxLength={30}
                  autoComplete="shipping postal-code"
                />
              </label>
              <label>
                Country code
                <input
                  name="country"
                  placeholder="e.g. US, GB, NG"
                  minLength={2}
                  maxLength={2}
                  pattern="[A-Za-z]{2}"
                  required
                  autoComplete="shipping country"
                />
              </label>
            </div>
            <button
              className="button outline"
              disabled={busy || !cart?.items.length}
            >
              {busy ? 'Calculating…' : 'Calculate delivery & tax'}
            </button>
            <small>
              Availability depends on the destination and the currency of your
              bag.
            </small>
          </form>
          <aside className="summary-card">
            <h2>Your order</h2>
            {cart?.items.map((item) => (
              <div className="summary-row" key={item.productId}>
                <span>
                  {item.name} <small>× {item.quantity}</small>
                </span>
                <strong>{money(item.lineTotal, cart.currency!)}</strong>
              </div>
            ))}
            {cart?.currency && (
              <>
                <div className="summary-row">
                  <span>Subtotal</span>
                  <strong>{money(cart.subtotal, cart.currency)}</strong>
                </div>
                <div className="summary-row">
                  <span>Delivery</span>
                  <span>
                    {quote
                      ? money(quote.shipping, quote.currency)
                      : 'Calculated from address'}
                  </span>
                </div>
                <div className="summary-row">
                  <span>Tax</span>
                  <span>
                    {quote
                      ? money(quote.tax, quote.currency)
                      : 'Calculated from address'}
                  </span>
                </div>
                {quote && (
                  <div className="summary-total">
                    <span>Total · {quote.currency}</span>
                    <strong>{money(quote.total, quote.currency)}</strong>
                  </div>
                )}
              </>
            )}
            <button
              className="button primary"
              disabled={!quote || busy}
              onClick={() => void place()}
            >
              Place order <ArrowRight size={17} />
            </button>
            <small>
              <LockKeyhole size={13} /> Payment follows on Stripe’s secure
              checkout page. An order remains unpaid until the payment is
              verified.
            </small>
          </aside>
        </div>
      )}
    </div>
  );
}
