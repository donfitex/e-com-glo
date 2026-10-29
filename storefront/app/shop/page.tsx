import Link from 'next/link';
import type { Metadata } from 'next';
import { categories, catalog, defaultCurrency } from '@/lib/server-api';
import { currencies } from '@/lib/types';
import { ProductCard } from '@/components/product-card';
export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Explore the collection' };
export default async function Shop({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const q = await searchParams;
  let taxonomy: Awaited<ReturnType<typeof categories>> = [];
  let products: Awaited<ReturnType<typeof catalog>> = {
    items: [],
    total: 0,
    page: 1,
    limit: 12,
  };
  let error = '';
  try {
    taxonomy = await categories();
    const category = taxonomy.find((c) => c.slug === q.category);
    products = await catalog({
      q: q.q,
      currency: q.currency ?? defaultCurrency(),
      categoryId: category?.id,
      sort: q.sort ?? 'newest',
      page: q.page ?? '1',
      limit: '12',
      minPrice: q.minPrice,
      maxPrice: q.maxPrice,
      available: q.available,
    });
  } catch {
    error =
      'The catalog could not be loaded. Check your filters and try again.';
  }
  const title =
    taxonomy.find((c) => c.slug === q.category)?.name ??
    (q.q ? `Results for “${q.q}”` : 'A world of good finds.');
  const pageLink = (page: number) =>
    `/shop?${new URLSearchParams({ ...Object.fromEntries(Object.entries(q).filter((p): p is [string, string] => typeof p[1] === 'string')), page: String(page) })}`;
  return (
    <div className="shell page">
      <div className="breadcrumb">
        <Link href="/">Home</Link> / Collection
      </div>
      <div className="page-heading">
        <span className="eyebrow muted">EXPLORE E-COM GLOBAL</span>
        <h1>{title}</h1>
        <p>Everyday essentials. A few unexpected favorites.</p>
      </div>
      <div className="shop-layout">
        <aside className="filters">
          <form action="/shop">
            <h2>Find your fit</h2>
            <label>
              Search
              <input
                name="q"
                placeholder="Search the collection"
                defaultValue={q.q}
              />
            </label>
            <label>
              Category
              <select name="category" defaultValue={q.category ?? ''}>
                <option value="">All categories</option>
                {taxonomy.map((c) => (
                  <option key={c.id} value={c.slug}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Currency
              <select
                name="currency"
                defaultValue={q.currency ?? defaultCurrency()}
              >
                {currencies.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
            <label>
              Sort by
              <select name="sort" defaultValue={q.sort ?? 'newest'}>
                <option value="newest">Newest arrivals</option>
                <option value="price_asc">Price: low to high</option>
                <option value="price_desc">Price: high to low</option>
                <option value="name">Name: A to Z</option>
              </select>
            </label>
            <label className="checkbox-label">
              <input
                type="checkbox"
                name="available"
                value="true"
                defaultChecked={q.available === 'true'}
              />{' '}
              In stock only
            </label>
            <button className="button primary" type="submit">
              Apply filters
            </button>
            <Link className="text-link" href="/shop">
              Reset filters
            </Link>
          </form>
          <div className="filter-note">
            Prices are listed in the selected currency. Changing currency shows
            products priced in that currency.
          </div>
        </aside>
        <div>
          <div className="results-heading">
            <span>{products.total} finds</span>
            <span>
              {q.currency ?? defaultCurrency()} · Page {products.page}
            </span>
          </div>
          {error ? (
            <div className="notice" role="alert">
              {error}
            </div>
          ) : products.items.length ? (
            <div className="product-grid shop-grid">
              {products.items.map((p) => (
                <ProductCard key={p.id} product={p} />
              ))}
            </div>
          ) : (
            <div className="empty-state">
              <h2>No finds just yet.</h2>
              <p>Try another search, category or currency.</p>
              <Link className="button primary" href="/shop">
                Browse all products
              </Link>
            </div>
          )}
          <nav className="pagination" aria-label="Pagination">
            {products.page > 1 && (
              <Link
                className="button outline"
                href={pageLink(products.page - 1)}
              >
                Previous
              </Link>
            )}
            {products.page * products.limit < products.total && (
              <Link
                className="button outline"
                href={pageLink(products.page + 1)}
              >
                Next page
              </Link>
            )}
          </nav>
        </div>
      </div>
    </div>
  );
}
