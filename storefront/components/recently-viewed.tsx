'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/client-api';
import type { Product } from '@/lib/types';
import { ProductCard } from './product-card';
const key = 'ecom-recent-v1';
function ids() {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? '[]');
    return Array.isArray(value)
      ? value
          .filter(
            (id): id is string =>
              typeof id === 'string' && /^[0-9a-f-]{36}$/.test(id),
          )
          .slice(0, 8)
      : [];
  } catch {
    return [];
  }
}
export function RecordProductView({ id }: { id: string }) {
  useEffect(() => {
    try {
      localStorage.setItem(
        key,
        JSON.stringify(
          [id, ...ids().filter((value) => value !== id)].slice(0, 8),
        ),
      );
    } catch {
      /* Optional device history never blocks shopping. */
    }
  }, [id]);
  return null;
}
export function RecentlyViewed({ excludeId }: { excludeId?: string }) {
  const [products, setProducts] = useState<Product[]>([]);
  useEffect(() => {
    let active = true;
    const recent = ids()
      .filter((id) => id !== excludeId)
      .slice(0, 4);
    void Promise.allSettled(
      recent.map((id) => api<Product>(`/products/${id}`)),
    ).then((results) => {
      if (active)
        setProducts(
          results.flatMap((result) =>
            result.status === 'fulfilled' ? [result.value] : [],
          ),
        );
    });
    return () => {
      active = false;
    };
  }, [excludeId]);
  if (!products.length) return null;
  return (
    <section className="shell section recently-viewed">
      <div className="section-heading">
        <div>
          <span className="eyebrow muted">PICK UP WHERE YOU LEFT OFF</span>
          <h2>Recently viewed.</h2>
          <p>Your browsing history stays on this device.</p>
        </div>
        <button
          className="text-link"
          onClick={() => {
            try {
              localStorage.removeItem(key);
            } catch {
              /* Storage can be disabled. */
            }
            setProducts([]);
          }}
        >
          Clear history
        </button>
      </div>
      <div className="product-grid">
        {products.map((product) => (
          <ProductCard key={product.id} product={product} />
        ))}
      </div>
    </section>
  );
}
