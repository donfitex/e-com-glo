'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Package,
  ShoppingBag,
  ArrowUpRight,
  Settings2,
  Heart,
} from 'lucide-react';
import { useWishlist } from './wishlist-provider';
import { useSession } from './session';
export function Account() {
  const { user, loading, logout } = useSession();
  const { ids } = useWishlist();
  const router = useRouter();
  if (loading) return <div className="shell page">Loading your account…</div>;
  if (!user)
    return (
      <div className="shell page empty-state">
        <h1>Your everyday, all together.</h1>
        <p>Sign in to see your account and orders.</p>
        <Link className="button primary" href="/login?next=/account">
          Sign in
        </Link>
      </div>
    );
  return (
    <div className="shell page">
      <div className="page-heading">
        <span className="eyebrow muted">YOUR E-COM GLOBAL</span>
        <h1>Hello, {user.name.split(' ')[0]}.</h1>
        <p>A good day for a new discovery.</p>
      </div>
      <div className="account-grid">
        <Link className="account-card" href="/account/orders">
          <Package />
          <h2>Your orders</h2>
          <p>See your purchases and delivery progress.</p>
          <ArrowUpRight />
        </Link>
        <Link className="account-card" href="/cart">
          <ShoppingBag />
          <h2>Your shopping bag</h2>
          <p>Pick up your next everyday favorites.</p>
          <ArrowUpRight />
        </Link>
        <Link className="account-card" href="/wishlist">
          <Heart />
          <h2>Saved products</h2>
          <p>{ids.length} good finds, ready for another look.</p>
          <ArrowUpRight />
        </Link>
        {user.role === 'ADMIN' && (
          <Link className="account-card" href="/admin">
            <Settings2 />
            <h2>Store management</h2>
            <p>Manage products, categories and orders.</p>
            <ArrowUpRight />
          </Link>
        )}
      </div>
      <div className="account-profile">
        <div>
          <strong>{user.name}</strong>
          <p>{user.email}</p>
        </div>
        <button
          className="button outline"
          onClick={async () => {
            await logout();
            router.push('/');
          }}
        >
          Sign out
        </button>
      </div>
    </div>
  );
}
