import type { Product } from '@/lib/types';
export function illustration(
  product: Pick<Product, 'attributes' | 'category'>,
) {
  const known = [
    'headphones',
    'bag',
    'lamp',
    'bottle',
    'shoes',
    'skincare',
    'book',
    'speaker',
  ];
  const value = product.attributes?.illustration;
  return known.includes(value)
    ? value
    : ({
        electronics: 'headphones',
        fashion: 'bag',
        'home-living': 'lamp',
        sports: 'bottle',
        beauty: 'skincare',
        books: 'book',
        toys: 'speaker',
        groceries: 'bottle',
      }[product.category?.slug] ?? 'bag');
}
export function ProductArt({
  kind,
  className = '',
  alt = '',
}: {
  kind: string;
  className?: string;
  alt?: string;
}) {
  return (
    <img
      className={`product-art ${className}`}
      src={`/products/${kind}.svg`}
      alt={alt}
      loading="lazy"
    />
  );
}
