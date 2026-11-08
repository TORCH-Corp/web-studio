/**
 * What the published store elements ask of the store API (part 2, W2), in the
 * browser. Same origin, relative URLs: the site's host is the site.
 *
 * A store that does not sell answers 404 `store_not_found` (PRD V1.1: store
 * elements then render nothing), which is a result, not a failure; everything
 * else that is not a success throws `StoreRequestError`.
 */

import type { StoreCategorySummary, StoreProduct } from '@/lib/platform/catalogue-rules';
import type { Confirmation, UnavailableLine } from '@/lib/platform/checkout-rules';
import type { CheckoutBody } from '@/lib/platform/store-elements/checkout-form';

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

// ---------------------------------------------------------------------------
// Checkout and the confirmation (session W6)
// ---------------------------------------------------------------------------

/** What `POST /ycode/api/store/checkout` came to, for the checkout element to show. */
export type CheckoutResult =
  /** The order exists (made now, or made by an earlier try of the same checkout). */
  | { kind: 'placed'; checkout_id: string; code: string }
  /** The route refused values: its messages by field path (`buyer.phone`), in the page's language. */
  | { kind: 'invalid'; fields: Record<string, string> }
  /** Items the store no longer sells; nothing was created. `name` is null when the catalogue no longer knows the item. */
  | { kind: 'item_unavailable'; items: UnavailableLine[] }
  /** Sales or Contact Center could not be reached, or the store cannot take orders now (or the buyer's own connection failed): nothing was created. */
  | { kind: 'service_unavailable' }
  /** The site's rate limit for this connection. */
  | { kind: 'rate_limited' }
  /** The store stopped selling while the buyer filled the form. */
  | { kind: 'not_selling' };

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Sends the checkout. The answers the buyer can act on are results; anything else (a body the route refused as not
 * ours, a cross-origin refusal, a 500, no connection) is logged and answered as `service_unavailable`, which the
 * form shows with the cart kept and a way to try again: nothing was created, and the same checkout id sent again
 * makes one order whatever happened to the first try.
 */
export async function postCheckout(body: CheckoutBody, signal?: AbortSignal): Promise<CheckoutResult> {
  let response: Response;
  try {
    response = await fetch('/ycode/api/store/checkout', {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    console.error('[store] the checkout could not be sent', error);
    return { kind: 'service_unavailable' };
  }
  let answer: unknown = null;
  try {
    answer = await response.json();
  } catch {
    // An answer that is not JSON (a proxy's error page) has no code; the status says enough.
  }
  const code = isObject(answer) && typeof answer.code === 'string' ? answer.code : null;

  if (response.ok && isObject(answer) && isObject(answer.data) && typeof answer.data.code === 'string' && typeof answer.data.checkout_id === 'string') {
    return { kind: 'placed', checkout_id: answer.data.checkout_id, code: answer.data.code };
  }
  if (response.status === 400 && code === 'invalid_checkout' && isObject(answer) && isObject(answer.fields)) {
    const fields: Record<string, string> = {};
    for (const [path, message] of Object.entries(answer.fields)) if (typeof message === 'string') fields[path] = message;
    return { kind: 'invalid', fields };
  }
  if (response.status === 422 && code === 'item_unavailable' && isObject(answer) && Array.isArray(answer.items)) {
    return { kind: 'item_unavailable', items: answer.items as UnavailableLine[] };
  }
  if (response.status === 429) return { kind: 'rate_limited' };
  if (response.status === 404 && code === 'store_not_found') return { kind: 'not_selling' };
  if (!(response.status === 503 && code === 'service_unavailable')) {
    console.error(`[store] the checkout answered ${response.status}${code ? ` ${code}` : ''}`);
  }
  return { kind: 'service_unavailable' };
}

/** What `GET /ycode/api/store/orders/{checkout_id}` came to. */
export type OrderResult = { kind: 'ok'; order: Confirmation } | { kind: 'not_found' } | { kind: 'not_selling' };

/** Reads the order a checkout became: `not_found` for a checkout this site has no order for. Anything else that is not a success throws `StoreRequestError`. */
export async function fetchOrder(checkoutId: string, signal?: AbortSignal): Promise<OrderResult> {
  try {
    const result = await get<{ data: Confirmation }>(`/ycode/api/store/orders/${encodeURIComponent(checkoutId)}`, signal);
    return result.kind === 'ok' ? { kind: 'ok', order: result.value.data } : { kind: 'not_selling' };
  } catch (error) {
    if (error instanceof StoreRequestError && error.status === 404 && error.code === 'order_not_found') return { kind: 'not_found' };
    throw error;
  }
}
