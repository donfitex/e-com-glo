'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Heart } from 'lucide-react';
import { api } from '@/lib/client-api';
import type { Product, Page } from '@/lib/types';
import { useSession } from './session';
import { useWishlist } from './wishlist-provider';
import { ProductCard } from './product-card';
export function WishlistPage() {
  const { user, loading } = useSession();
  const { revision, toggle } = useWishlist();
  const [data, setData] = useState<Page<{
    productId: string;
    product: Product | null;
  }> | null>(null);
  const [page, setPage] = useState(1);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!user) return;
    let active = true;
    api<Page<{ productId: string; product: Product | null }>>(
      `/wishlist?page=${page}&limit=12`,
    )
      .then((value) => {
        if (active) {
          if (!value.items.length && page > 1 && value.total > 0) {
            setPage(Math.max(1, Math.ceil(value.total / 12)));
            return;
          }
          setData(value);
          setError('');
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [user, page, revision]);
  if (loading) return <p>Loading saved products…</p>;
  if (!user)
    return (
      <div className="empty-state">
        <Heart />
        <h1>Keep your good finds close.</h1>
        <p>Sign in to save products across your devices.</p>
        <Link href="/login?next=/wishlist" className="button primary">
          Sign in to save products
        </Link>
      </div>
    );
  return (
    <>
      <div className="page-heading">
        <span className="eyebrow muted">YOUR PERSONAL COLLECTION</span>
        <h1>Saved for later.</h1>
        <p>
          {data ? `${data.total} saved products` : 'Loading your collection…'}
        </p>
      </div>
      {error && (
        <div className="notice error" role="alert">
          {error}
        </div>
      )}
      {data?.items.length ? (
        <div className="product-grid">
          {data.items.map((item) =>
            item.product ? (
              <ProductCard key={item.productId} product={item.product} />
            ) : (
              <article className="unavailable-product" key={item.productId}>
                <Heart />
                <h2>This item is no longer available.</h2>
                <button
                  className="text-link"
                  onClick={() => void toggle(item.productId)}
                >
                  Remove saved item
                </button>
              </article>
            ),
          )}
        </div>
      ) : (
        data && (
          <div className="empty-state">
            <Heart />
            <h2>A little inspiration, saved.</h2>
            <p>Use the heart on a product to add it to your collection.</p>
            <Link href="/shop" className="button primary">
              Explore the collection
            </Link>
          </div>
        )
      )}
      <div className="pagination">
        {page > 1 && (
          <button className="button outline" onClick={() => setPage(page - 1)}>
            Previous
          </button>
        )}
        {data && page * 12 < data.total && (
          <button className="button outline" onClick={() => setPage(page + 1)}>
            Next page
          </button>
        )}
      </div>
    </>
  );
}
