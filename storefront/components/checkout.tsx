'use client';
import { useState, useRef, useEffect, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { LockKeyhole, ArrowRight } from 'lucide-react';
import { launchPaystack } from '@/lib/payments';
import { api, ApiError, announceCart } from '@/lib/client-api';
import { useSession } from './session';
import {
  money,
  type Cart,
  type Address,
  type Quote,
  type Order,
} from '@/lib/types';
import type { SavedAddress } from './address-book';
interface CheckoutOptions {
  destinations: { country: string; currency: string }[];
  paymentCurrencies: string[] | null;
}
const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });
export function Checkout() {
  const { user, loading } = useSession();
  const router = useRouter();
  const [cart, setCart] = useState<Cart | null>(null);
  const [options, setOptions] = useState<CheckoutOptions | null>(null);
  const destinations =
    options?.destinations.filter(
      (destination) => destination.currency === cart?.currency,
    ) ?? [];
  const paymentSupported =
    !cart?.total ||
    !options?.paymentCurrencies ||
    options.paymentCurrencies.includes(cart.currency!);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [address, setAddress] = useState<Address | null>(null);
  const key = useRef<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [savedAddresses, setSavedAddresses] = useState<SavedAddress[]>([]);
  const [selectedAddress, setSelectedAddress] = useState('');
  const [saveAddress, setSaveAddress] = useState(true);
  useEffect(() => {
    if (user)
      api<SavedAddress[]>('/addresses')
        .then(setSavedAddresses)
        .catch(() => {});
  }, [user]);
  function chooseAddress(id: string) {
    const selected = savedAddresses.find((a) => a.id === id);
    const form = formRef.current;
    setSelectedAddress(id);
    if (!form) return;
    const values = selected?.address;
    for (const field of [
      'name',
      'email',
      'phone',
      'line1',
      'line2',
      'city',
      'region',
      'postalCode',
      'country',
    ] as const) {
      const input = form.elements.namedItem(field);
      if (
        input instanceof HTMLInputElement ||
        input instanceof HTMLSelectElement
      )
        input.value =
          values?.[field] ??
          (field === 'name'
            ? (user?.name ?? '')
            : field === 'email'
              ? (user?.email ?? '')
              : '');
    }
    revision.current++;
    setQuote(null);
    setAddress(null);
    key.current = null;
  }
  const revision = useRef(0);
  useEffect(() => {
    if (user)
      Promise.all([
        api<Cart>('/cart'),
        api<CheckoutOptions>('/checkout/options'),
      ])
        .then(([cart, options]) => {
          setCart(cart);
          setOptions(options);
        })
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
          saveAddress,
          quote: { total: quote.total, ruleVersion: quote.ruleVersion },
        }),
      });
      announceCart();
      if (order.paymentStatus === 'PAID') {
        router.push(`/checkout/payment?order=${order.id}`);
        return;
      }
      try {
        await launchPaystack(order.id);
      } catch (paymentError) {
        const next = `/checkout/payment?order=${order.id}`;
        router.push(
          paymentError instanceof ApiError && paymentError.status === 401
            ? `/login?next=${encodeURIComponent(next)}`
            : `${next}&retry=1`,
        );
      }
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
      {cart?.items.length &&
      options &&
      (!destinations.length || !paymentSupported) ? (
        <div className="notice" role="status">
          {!paymentSupported
            ? `Paystack payments are not enabled for your bag’s ${cart.currency} currency.`
            : `No delivery rates are configured for your bag’s ${cart.currency} currency.`}{' '}
          Please contact the store before placing this order. Your bag has been
          kept.
        </div>
      ) : null}
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
            ref={formRef}
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
            {savedAddresses.length > 0 && (
              <div className="saved-address-picker">
                <label>
                  Use a saved delivery address
                  <select
                    value={selectedAddress}
                    onChange={(e) => chooseAddress(e.target.value)}
                  >
                    <option value="">Enter a new address</option>
                    {savedAddresses.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.label}
                        {a.isDefault ? ' · Default' : ''} · {a.address.city},{' '}
                        {a.address.country}
                      </option>
                    ))}
                  </select>
                </label>
                <small>
                  Review and edit the fields below before calculating delivery.{' '}
                  <Link href="/account/addresses">Manage addresses</Link>
                </small>
              </div>
            )}

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
            <div className="form-columns">
              <label>
                Contact email
                <input
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  maxLength={254}
                  defaultValue={user.email}
                />
              </label>
              <label>
                Phone number
                <input
                  name="phone"
                  type="tel"
                  autoComplete="tel"
                  required
                  maxLength={40}
                  placeholder="+234 801 234 5678"
                  aria-describedby="checkout-phone-help"
                />
              </label>
            </div>
            <small id="checkout-phone-help">
              Include your country code, for example +234 for Nigeria.
            </small>
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
                Delivery country
                <select
                  name="country"
                  required
                  autoComplete="shipping country"
                  defaultValue=""
                  disabled={!destinations.length}
                >
                  <option value="" disabled>
                    {options
                      ? 'Choose a delivery country'
                      : 'Loading delivery countries…'}
                  </option>
                  {destinations.map(({ country }) => (
                    <option key={country} value={country}>
                      {regionNames.of(country) ?? country} ({country})
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="preference-control">
              <input
                type="checkbox"
                checked={saveAddress}
                onChange={(e) => setSaveAddress(e.target.checked)}
              />
              <span>
                Save this delivery address for my next checkout
                <small>
                  Up to ten addresses. You can remove saved locations in your
                  account.
                </small>
              </span>
            </label>
            <button
              className="button outline"
              disabled={
                busy ||
                !cart?.items.length ||
                !destinations.length ||
                !paymentSupported
              }
            >
              {busy ? 'Calculating…' : 'Calculate delivery & tax'}
            </button>
            <small>
              {cart?.currency
                ? `Delivery countries shown accept your bag’s ${cart.currency} currency.`
                : 'Delivery countries appear once your bag is loaded.'}
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
                  <div className="delivery-window">
                    <strong>Estimated shipping time</strong>
                    <p>
                      {quote.deliveryMinDays ?? 3}–{quote.deliveryMaxDays ?? 7}{' '}
                      calendar days after payment confirmation.
                    </p>
                  </div>
                )}
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
              <LockKeyhole size={13} /> Payment follows on Paystack’s secure
              checkout page. An order remains unpaid until the payment is
              verified.
            </small>
          </aside>
        </div>
      )}
    </div>
  );
}
