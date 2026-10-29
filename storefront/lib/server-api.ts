import { cache } from 'react';
import type { SiteContent } from './site-content';
import type { Category, Product, Page } from './types';
export function apiOrigin() {
  const url = new URL(process.env.COMMERCE_API_URL ?? 'http://127.0.0.1:3000');
  if (!['http:', 'https:'].includes(url.protocol))
    throw new Error('Invalid API origin');
  return url.origin;
}
export class BackendError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function publicApi<T>(path: string): Promise<T> {
  const response = await fetch(`${apiOrigin()}/api/v1${path}`, {
    cache: 'no-store',
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok)
    throw new BackendError(
      response.status,
      'The catalog is temporarily unavailable. Please try again.',
    );
  return (await response.json()).data as T;
}
export async function catalog(query: Record<string, string | undefined> = {}) {
  const params = new URLSearchParams(
    Object.entries(query).filter((entry): entry is [string, string] =>
      Boolean(entry[1]),
    ),
  );
  return publicApi<Page<Product>>(
    `${query.q ? '/search' : '/products'}?${params}`,
  );
}
export const categories = () => publicApi<Category[]>('/categories');
export async function safeCatalog(
  query: Record<string, string | undefined> = {},
) {
  try {
    const [products, taxonomy] = await Promise.all([
      catalog(query),
      categories(),
    ]);
    return { products, categories: taxonomy, error: null };
  } catch {
    return {
      products: { items: [], total: 0, page: 1, limit: 20 },
      categories: [] as Category[],
      error: 'We couldn’t load the catalog. Please try again shortly.',
    };
  }
}

export function defaultCurrency() {
  return ['NGN', 'USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY', 'INR'].includes(
    process.env.DEFAULT_CURRENCY ?? '',
  )
    ? process.env.DEFAULT_CURRENCY!
    : 'NGN';
}

export const siteContent = cache(async (): Promise<SiteContent | null> => {
  try {
    const response = await fetch(`${apiOrigin()}/api/v1/site-content`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(2000),
    });
    return response.ok ? (await response.json()).data : null;
  } catch {
    return null;
  }
});
