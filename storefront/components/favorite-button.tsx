'use client';
import Link from 'next/link';
import { Heart } from 'lucide-react';
import { useWishlist } from './wishlist-provider';
import { useSession } from './session';
export function FavoriteButton({
  id,
  name,
  compact = true,
}: {
  id: string;
  name: string;
  compact?: boolean;
}) {
  const { user, loading } = useSession();
  const { ids, pending, toggle, loading: wishlistLoading } = useWishlist();
  const saved = ids.includes(id);
  const content = (
    <>
      <Heart
        size={18}
        fill={saved ? 'currentColor' : 'none'}
        aria-hidden="true"
      />
      {!compact && <span>{saved ? 'Saved' : 'Save for later'}</span>}
    </>
  );
  const className = compact ? 'favorite-button' : 'button outline';
  return user ? (
    <button
      type="button"
      className={className}
      aria-label={`${saved ? 'Remove' : 'Save'} ${name}${saved ? ' from saved products' : ' for later'}`}
      aria-pressed={saved}
      disabled={pending.has(id) || loading || wishlistLoading}
      onClick={() => void toggle(id)}
    >
      {content}
    </button>
  ) : (
    <Link
      className={className}
      href={`/login?next=${encodeURIComponent(`/products/${id}`)}`}
      aria-label={`Sign in to save ${name}`}
    >
      {content}
    </Link>
  );
}
