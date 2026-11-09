'use client';

import React, { useEffect, useRef, useState } from 'react';
import { cardOf, type CardData } from '@/lib/platform/store-elements/card-data';
import { CardSkeleton, ErrorAlert, ProductCardView } from '@/lib/platform/store-elements/CardView';
import { addToCart } from '@/lib/platform/store-elements/add-to-cart';
import { CARD_SELECTOR, featuredFor, featuredPageSize, featuredPlace, firstProducts } from '@/lib/platform/store-elements/featured';
import type { StoreLinks } from '@/lib/platform/store-elements/links';
import { fetchProduct, StoreRequestError } from '@/lib/platform/store-elements/store-client';
import type { StoreLang } from '@/lib/platform/store-elements/strings';

type State = { kind: 'loading' } | { kind: 'error' } | { kind: 'hidden' } | { kind: 'ready'; card: CardData };

/** The product the builder picked; null when the store does not sell or the product is not on sale any more. */
async function readPicked(productId: string, signal: AbortSignal): Promise<CardData | null> {
  try {
    const result = await fetchProduct(productId, signal);
    return result.kind === 'ok' ? cardOf(result.value.data) : null;
  } catch (error) {
    if (error instanceof StoreRequestError && error.code === 'product_not_found') return null;
    throw error;
  }
}

/** The product an unpicked card shows, by its place among the page's unpicked cards (featured.ts); null when the store has none left for it. */
async function readFeatured(wrapper: Element | null): Promise<CardData | null> {
  const where = wrapper ? featuredPlace(wrapper.ownerDocument, wrapper) : null;
  if (!where) return null;
  const result = await firstProducts(featuredPageSize(where.unpicked, where.picked.length));
  if (result.kind === 'not_selling') return null;
  const product = featuredFor(result.value.data, where.picked, where.place);
  return product ? cardOf(product) : null;
}

interface Props {
  /** The product the builder picked; null for a card left to show one of the store's first products. */
  productId: string | null;
  lang: StoreLang;
  links: StoreLinks;
  /** Told when the card has nothing to show, and when it has again: the wrapper then takes no room in its row. */
  onEmpty: (empty: boolean) => void;
}

/**
 * A single product card on a published page: the product the builder picked, or, with none picked, one of the
 * store's first products (Featured products is four cards). The store does not sell, the picked product is not
 * on sale any more, or the store has fewer products than the page has cards: it renders nothing, so a featured
 * row shortens instead of showing a dead card. A catalogue that cannot be read shows the designed error with a
 * way to try again.
 */
export default function ProductCardElement({ productId, lang, links, onEmpty }: Props) {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  // Always in the page, whatever the card shows: an unpicked card finds its wrapper, and its place among the others, from it.
  const marker = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    setState({ kind: 'loading' });
    // The first products are one request shared by the page's cards, so it is not this card's to abort: a card that
    // has gone ignores the answer instead.
    (productId ? readPicked(productId, controller.signal) : readFeatured(marker.current?.closest(CARD_SELECTOR) ?? null))
      .then((card) => {
        if (!controller.signal.aborted) setState(card ? { kind: 'ready', card } : { kind: 'hidden' });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        console.error('[store] the product could not be read', error);
        setState({ kind: 'error' });
      });
    return () => controller.abort();
  }, [productId, attempt]);

  const empty = state.kind === 'hidden';
  useEffect(() => {
    onEmpty(empty);
  }, [empty, onEmpty]);

  let shown: React.ReactNode = null;
  if (state.kind === 'loading') shown = <CardSkeleton />;
  else if (state.kind === 'error') shown = <ErrorAlert lang={lang} onRetry={() => setAttempt((n) => n + 1)} />;
  else if (state.kind === 'ready') shown = <ProductCardView
    card={state.card} lang={lang}
    href={links.product(state.card.id)} onAdd={addToCart}
                                           />;
  return (
    <>
      <span ref={marker} hidden />
      {shown}
    </>
  );
}
