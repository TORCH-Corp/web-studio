'use client';

import React, { useEffect, useState } from 'react';
import { cardOf, type CardData } from '@/lib/platform/store-elements/card-data';
import { CardSkeleton, ErrorAlert, ProductCardView } from '@/lib/platform/store-elements/CardView';
import { addToCart } from '@/lib/platform/store-elements/add-to-cart';
import { productHref, type LinkLocale } from '@/lib/platform/store-elements/links';
import { fetchProduct, StoreRequestError } from '@/lib/platform/store-elements/store-client';
import type { StoreLang } from '@/lib/platform/store-elements/strings';

type State = { kind: 'loading' } | { kind: 'error' } | { kind: 'hidden' } | { kind: 'ready'; card: CardData };

/**
 * A single product card on a published page, for the product the builder chose (Featured products is four of
 * them). Nothing is chosen, the store does not sell, or the product is not on sale any more: it renders
 * nothing, so a featured row shortens instead of showing a dead card. A catalogue that cannot be read shows the
 * designed error with a way to try again.
 */
export default function ProductCardElement({ productId, lang, locale }: { productId: string | null; lang: StoreLang; locale?: LinkLocale | null }) {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!productId) return;
    const controller = new AbortController();
    setState({ kind: 'loading' });
    fetchProduct(productId, controller.signal)
      .then((result) => setState(result.kind === 'ok' ? { kind: 'ready', card: cardOf(result.value.data) } : { kind: 'hidden' }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (error instanceof StoreRequestError && error.code === 'product_not_found') return setState({ kind: 'hidden' });
        console.error('[store] the product could not be read', error);
        setState({ kind: 'error' });
      });
    return () => controller.abort();
  }, [productId, attempt]);

  if (!productId || state.kind === 'hidden') return null;
  if (state.kind === 'loading') return <CardSkeleton />;
  if (state.kind === 'error') return <ErrorAlert lang={lang} onRetry={() => setAttempt((n) => n + 1)} />;
  return <ProductCardView
    card={state.card} lang={lang}
    href={productHref(state.card.id, locale)} onAdd={addToCart}
         />;
}
