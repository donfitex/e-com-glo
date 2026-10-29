import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ShieldCheck, PackageCheck } from 'lucide-react';
import { publicApi, BackendError } from '@/lib/server-api';
import { Product, money } from '@/lib/types';
import { ProductArt, illustration } from '@/components/product-art';
import { AddToCart } from '@/components/add-to-cart';
export const dynamic = 'force-dynamic';
export default async function ProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  let product: Product;
  try {
    product = await publicApi<Product>(`/products/${encodeURIComponent(id)}`);
  } catch (e) {
    if (e instanceof BackendError && e.status === 404) notFound();
    throw e;
  }
  return (
    <div className="shell page">
      <div className="breadcrumb">
        <Link href="/">Home</Link> / <Link href="/shop">Collection</Link> /{' '}
        {product.name}
      </div>
      <div className="product-detail">
        <div
          className={`detail-art art-${illustration(product).startsWith('/') ? 'photo' : illustration(product)}`}
        >
          <ProductArt kind={illustration(product)} alt={product.name} />
        </div>
        <div className="detail-copy">
          <Link
            className="eyebrow muted"
            href={`/shop?category=${product.category.slug}`}
          >
            {product.category.name}
          </Link>
          <h1>{product.name}</h1>
          <div className="detail-price">
            {money(product.price, product.currency)}{' '}
            <small>{product.currency}</small>
          </div>
          <p className="detail-description">{product.description}</p>
          <span className={product.stock ? 'availability' : 'form-error'}>
            {product.stock
              ? '● In stock and ready for your everyday'
              : 'Currently out of stock'}
          </span>
          <AddToCart productId={product.id} stock={product.stock} />
          <div className="detail-benefits">
            <span>
              <ShieldCheck size={19} /> Protected account and checkout
            </span>
            <span>
              <PackageCheck size={19} /> Delivery and tax shown before you order
            </span>
          </div>
          <details open>
            <summary>The details</summary>
            <dl>
              <div>
                <dt>SKU</dt>
                <dd>{product.sku}</dd>
              </div>
              {Object.entries(product.attributes)
                .filter(([key]) => key !== 'illustration')
                .map(([key, value]) => (
                  <div key={key}>
                    <dt>{key}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
            </dl>
          </details>
        </div>
      </div>
    </div>
  );
}
