/**
 * What the published store elements ask of the store API (part 2, W2), in the
 * browser. Same origin, relative URLs: the site's host is the site.
 *
 * A store that does not sell answers 404 `store_not_found` (PRD V1.1: store
 * elements then render nothing), which is a result, not a failure; everything
 * else that is not a success throws `StoreRequestError`.
 */

import type { StoreCategorySummary, StoreProduct } from '@/lib/platform/catalogue-rules';

export class StoreRequestError extends Error {
  constructor(message: string, readonly status: number, readonly code: string | null) {
    super(message);
    this.name = 'StoreRequestError';
  }
}

export type StoreResult<T> = { kind: 'ok'; value: T } | { kind: 'not_selling' };

async function get<T>(url: string, signal?: AbortSignal): Promise<StoreResult<T>> {
  const response = await fetch(url, { signal, headers: { Accept: 'application/json' } });
  if (response.ok) return { kind: 'ok', value: (await response.json()) as T };
  let code: string | null = null;
  try {
    code = ((await response.json()) as { code?: string }).code ?? null;
  } catch {
    // An answer that is not JSON (a proxy's error page) has no code; the status says enough.
  }
  if (response.status === 404 && code === 'store_not_found') return { kind: 'not_selling' };
  throw new StoreRequestError(`${url} answered ${response.status}${code ? ` ${code}` : ''}`, response.status, code);
}

export interface ProductsQuery {
  page: number;
  pageSize: number;
  /** One category (a chip, or the page's ?category=). */
  category?: string | null;
  /** The grid's own categories, when no single one is chosen. */
  categories?: string[];
  q?: string;
}

export function productsUrl(query: ProductsQuery): string {
  const params = new URLSearchParams({ page: String(query.page), page_size: String(query.pageSize) });
  if (query.category) params.set('category', query.category);
  else if (query.categories?.length) params.set('categories', query.categories.join(','));
  if (query.q) params.set('q', query.q);
  return `/ycode/api/store/products?${params}`;
}

export const fetchProducts = (query: ProductsQuery, signal?: AbortSignal) =>
  get<{ data: StoreProduct[]; meta: { page: number; page_size: number; total: number } }>(productsUrl(query), signal);

export const fetchCategories = (signal?: AbortSignal) => get<{ data: StoreCategorySummary[] }>('/ycode/api/store/categories', signal);

export const fetchProduct = (id: string, signal?: AbortSignal) => get<{ data: StoreProduct }>(`/ycode/api/store/products/${encodeURIComponent(id)}`, signal);

export const fetchStoreSettings = (signal?: AbortSignal) => get<{ data: { selling: true; currency: 'IQD' | 'USD'; delivery_fee: string } }>('/ycode/api/store/settings', signal);
