import Link from 'next/link';
import { FavoriteButton } from './favorite-button';
import { ArrowUpRight } from 'lucide-react';
import type { Product } from '@/lib/types';
import { money } from '@/lib/types';
import { ProductArt, illustration } from './product-art';
export function ProductCard({ product }: { product: Product }) {
  return (
    <article className="product-card">
      <div className="product-media">
        <Link
          className={`product-image art-${illustration(product).startsWith('/') ? 'photo' : illustration(product)}`}
          href={`/products/${product.id}`}
        >
          <ProductArt kind={illustration(product)} alt={product.name} />
          <span className="product-quick" aria-hidden="true">
            <ArrowUpRight size={19} />
          </span>
          {!product.stock && <span className="stock-badge">Out of stock</span>}
        </Link>
        <FavoriteButton id={product.id} name={product.name} />
      </div>
      <div className="product-copy">
        <span className="eyebrow muted">{product.category.name}</span>
        <h3>
          <Link href={`/products/${product.id}`}>{product.name}</Link>
        </h3>
        <div className="product-price">
          {money(product.price, product.currency)}
          <span>{product.currency}</span>
        </div>
      </div>
    </article>
  );
}
