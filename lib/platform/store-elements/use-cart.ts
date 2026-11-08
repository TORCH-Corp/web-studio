'use client';

/**
 * What the cart and the checkout elements read in the browser (part 2, session
 * W6): the buyer's cart lines, the store's settings and the catalogue's answer
 * about the lines. The stores and the rules are elsewhere (cart-store.ts,
 * cart-refresh.ts, order-summary.ts, store-client.ts); these are the hooks that
 * connect them to React.
 */

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { NOTHING_REFRESHED, refreshCart, type CartRefresh, type ProductRead } from '@/lib/platform/store-elements/cart-refresh';
import { getCartStore, subscribeToCart, type CartLine } from '@/lib/platform/store-elements/cart-store';
import type { StoreTerms } from '@/lib/platform/store-elements/order-summary';
import { fetchProduct, fetchStoreSettings, StoreRequestError } from '@/lib/platform/store-elements/store-client';

const NO_LINES: readonly CartLine[] = Object.freeze([]);

/**
 * The connected cart's lines, following it as it changes. The server and the first browser render see an empty
 * cart (the cart is only in the browser), so `ready` says when the lines are the buyer's: the elements draw their
 * skeleton until then and not an empty cart that is not.
 */
export function useCartLines(): { lines: readonly CartLine[]; ready: boolean } {
  const lines = useSyncExternalStore(subscribeToCart, () => getCartStore().lines(), () => NO_LINES);
  // False in the server's render and in the browser's first (hydrating) one, true from then on.
  const ready = useSyncExternalStore(noSubscription, () => true, () => false);
  return { lines, ready };
}

const noSubscription = () => () => {};

export type StoreTermsState =
  | { kind: 'loading' }
  | { kind: 'ok'; terms: StoreTerms }
  | { kind: 'error' }
  /** The store does not sell: the element renders nothing. */
  | { kind: 'not_selling' };

/** The store's currency and delivery fee (`GET /ycode/api/store/settings`), and `retry` for when they could not be read. */
export function useStoreTerms(): { state: StoreTermsState; retry: () => void } {
  const [state, setState] = useState<StoreTermsState>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    fetchStoreSettings(controller.signal)
      .then((result) => {
        if (result.kind === 'not_selling') return setState({ kind: 'not_selling' });
        setState({ kind: 'ok', terms: { currency: result.value.data.currency, delivery_fee: result.value.data.delivery_fee } });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        console.error('[store] the store settings could not be read', error);
        setState({ kind: 'error' });
      });
    return () => controller.abort();
  }, [attempt]);

  const retry = useCallback(() => {
    setState({ kind: 'loading' });
    setAttempt((n) => n + 1);
  }, []);
  return { state, retry };
}

/** A product as the catalogue has it now, for the refresh. */
async function readProduct(productId: string, signal: AbortSignal): Promise<ProductRead> {
  try {
    const result = await fetchProduct(productId, signal);
    // A store that stopped selling has nothing to say about a price; the settings read says so and the element hides.
    return result.kind === 'ok' ? { kind: 'found', product: result.value.data } : { kind: 'failed' };
  } catch (error) {
    if (error instanceof StoreRequestError && error.code === 'product_not_found') return { kind: 'gone' };
    if (!signal.aborted) console.error('[store] a product of the cart could not be read', error);
    return { kind: 'failed' };
  }
}

/**
 * Reads the products in the cart once when the element opens (and again on `retry`) and updates the cart's lines
 * with what the catalogue says now: the answer is what changed and what is no longer sold (cart-refresh.ts).
 */
export function useCartRefresh(enabled: boolean): { report: CartRefresh; running: boolean; retry: () => void } {
  const [attempt, setAttempt] = useState(0);
  /** What the last walk found, and which attempt it was. */
  const [result, setResult] = useState<{ attempt: number; report: CartRefresh } | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    refreshCart(getCartStore(), (id) => readProduct(id, controller.signal))
      .then((report) => {
        if (!controller.signal.aborted) setResult({ attempt, report });
      })
      .catch((error: unknown) => {
        // The walk itself has no way to fail but a bug (a read never throws); it is not hidden.
        if (controller.signal.aborted) return;
        console.error('[store] the cart could not be refreshed', error);
        setResult({ attempt, report: { ...NOTHING_REFRESHED, failed: true } });
      });
    return () => controller.abort();
  }, [enabled, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { report: result?.report ?? NOTHING_REFRESHED, running: enabled && result?.attempt !== attempt, retry };
}
