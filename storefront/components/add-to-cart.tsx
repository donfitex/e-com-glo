'use client';
import { useState } from 'react';
import Link from 'next/link';
import { ShoppingBag, Check } from 'lucide-react';
import { api, ApiError, announceCart } from '@/lib/client-api';
import { useSession } from './session';
import type { Cart } from '@/lib/types';
export function AddToCart({
  productId,
  stock,
}: {
  productId: string;
  stock: number;
}) {
  const { user } = useSession();
  const [quantity, setQuantity] = useState(1);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [success, setSuccess] = useState(false);
  async function add() {
    setBusy(true);
    setMessage('');
    try {
      const cart = await api<Cart>('/cart');
      const existing =
        cart.items.find((i) => i.productId === productId)?.quantity ?? 0;
      await api('/cart/items', {
        method: 'POST',
        body: JSON.stringify({ productId, quantity: existing + quantity }),
      });
      announceCart();
      setSuccess(true);
      setMessage('Added to your bag.');
    } catch (e) {
      setSuccess(false);
      setMessage(
        e instanceof ApiError ? e.message : 'Could not update your bag.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="purchase-controls">
      <label>
        Quantity
        <select
          value={quantity}
          onChange={(e) => setQuantity(Number(e.target.value))}
        >
          {Array.from({ length: Math.min(stock, 10) }, (_, i) => (
            <option key={i + 1}>{i + 1}</option>
          ))}
        </select>
      </label>
      {user ? (
        <button
          disabled={!stock || busy}
          className="button primary"
          onClick={add}
        >
          {success ? <Check size={19} /> : <ShoppingBag size={19} />}{' '}
          {busy ? 'Adding…' : stock ? 'Add to bag' : 'Out of stock'}
        </button>
      ) : (
        <Link
          className="button primary"
          href={`/login?next=/products/${productId}`}
        >
          Sign in to add to bag
        </Link>
      )}
      <p role="status" className={success ? 'success' : 'form-error'}>
        {message} {success && <Link href="/cart">View bag →</Link>}
      </p>
    </div>
  );
}
