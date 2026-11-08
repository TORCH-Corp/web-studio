'use client';

import React, { useCallback, useEffect, useState } from 'react';
import type { StoreProduct } from '@/lib/platform/catalogue-rules';
import { addProductToCart } from '@/lib/platform/store-elements/add-to-cart';
import { nameFor } from '@/lib/platform/store-elements/card-data';
import { ErrorAlert } from '@/lib/platform/store-elements/CardView';
import { MAX_LINE_QUANTITY } from '@/lib/platform/store-elements/cart-store';
import type { StoreLinks } from '@/lib/platform/store-elements/links';
import type { ProductPageState } from '@/lib/platform/store-elements/pages';
import { initialSelection, selectOption, variantFor, type Selection } from '@/lib/platform/store-elements/picker';
import { ProductDetailSkeleton, ProductDetailView, ProductGoneView, type AddedNotice } from '@/lib/platform/store-elements/ProductDetailView';
import { fetchProduct, StoreRequestError } from '@/lib/platform/store-elements/store-client';
import type { StoreLang } from '@/lib/platform/store-elements/strings';

type State =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'hidden' }
  | { kind: 'gone' }
  | { kind: 'ready'; product: StoreProduct };

interface Props {
  lang: StoreLang;
  links: StoreLinks;
  /** What the server found for the item the page's URL names (the page with the product role); `unknown` when the catalogue could not be asked, which the element then does itself. */
  pageProduct?: ProductPageState;
  /** The product the builder chose, for the element on any other page. */
  chosenProductId: string | null;
}

function startState(pageProduct: ProductPageState | undefined, chosenProductId: string | null): State {
  if (pageProduct) {
    if (pageProduct.kind === 'found') return { kind: 'ready', product: pageProduct.product };
    return pageProduct.kind === 'gone' ? { kind: 'gone' } : { kind: 'loading' };
  }
  return chosenProductId ? { kind: 'loading' } : { kind: 'hidden' };
}

/** The item to read again once the page is in the browser: the one the URL names, else the one the builder chose. */
function liveItemId(pageProduct: ProductPageState | undefined, chosenProductId: string | null): string | null {
  if (pageProduct) return pageProduct.kind === 'found' ? pageProduct.product.id : pageProduct.item_id;
  return chosenProductId;
}

const clampQuantity = (n: number) => Math.min(MAX_LINE_QUANTITY, Math.max(1, n));

/** The options of the variant in the page's language, for the "added" notice. */
function optionNames(product: StoreProduct, selection: Selection, lang: StoreLang): string[] {
  const variant = variantFor(product, selection);
  return (variant?.axes ?? []).map((axis) => (lang === 'ar' && axis.option_ar ? axis.option_ar : axis.option));
}

/**
 * The product page element on a published page: the product the server found for the URL (or the one the builder
 * chose), read again from the store API once the page is in the browser (notebook W5 grill-me, 8 Nov 2026): a
 * product that has gone since the page was cached shows "no longer available", one that came back or changed shows
 * as it is now. The server and the first browser render are the injected product, so the cached page and the
 * hydrated one agree. A store that does not sell renders nothing.
 */
export default function ProductDetail({ lang, links, pageProduct, chosenProductId }: Props) {
  const [state, setState] = useState<State>(() => startState(pageProduct, chosenProductId));
  const [attempt, setAttempt] = useState(0);
  const [selection, setSelection] = useState<Selection>(() => (pageProduct?.kind === 'found' ? initialSelection(pageProduct.product) : {}));
  const [pickedImage, setPickedImage] = useState<string | null>(null);
  const [quantity, setQuantity] = useState('1');
  const [added, setAdded] = useState<AddedNotice | null>(null);
  const [cartFull, setCartFull] = useState(false);

  const itemId = liveItemId(pageProduct, chosenProductId);

  // The server's answer may have changed by the time the page is open: read the item again.
  useEffect(() => {
    if (!itemId) return;
    const controller = new AbortController();
    fetchProduct(itemId, controller.signal)
      .then((result) => {
        if (result.kind === 'not_selling') return setState({ kind: 'hidden' });
        const product = result.value.data;
        setState({ kind: 'ready', product });
        // Keep the buyer's choice when it is still a variant that can be bought; otherwise open on the cheapest.
        setSelection((current) => {
          const kept = variantFor(product, current);
          return kept?.available ? current : initialSelection(product);
        });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (error instanceof StoreRequestError && error.code === 'product_not_found') {
          setState({ kind: 'gone' });
          return;
        }
        console.error('[store] the product could not be read', error);
        // A product the server already sent stays on show; one that was never loaded has the designed error.
        setState((current) => (current.kind === 'loading' ? { kind: 'error' } : current));
      });
    return () => controller.abort();
  }, [itemId, attempt]);

  const onSelect = useCallback(
    (specificationId: string, optionId: string) => {
      if (state.kind !== 'ready') return;
      setSelection((current) => selectOption(state.product, current, specificationId, optionId));
      setPickedImage(null);
    },
    [state],
  );

  if (state.kind === 'hidden') return null;
  if (state.kind === 'loading') return <ProductDetailSkeleton lang={lang} />;
  if (state.kind === 'error') return <ErrorAlert lang={lang} onRetry={() => { setState({ kind: 'loading' }); setAttempt((n) => n + 1); }} />;
  if (state.kind === 'gone') return <ProductGoneView lang={lang} links={links} />;

  const { product } = state;
  const variant = variantFor(product, selection);

  const commitQuantity = () => setQuantity(String(clampQuantity(Math.round(Number(quantity)) || 1)));

  const onAdd = () => {
    const count = clampQuantity(Math.round(Number(quantity)) || 1);
    setQuantity(String(count));
    const result = addProductToCart(product, variant, count);
    if (result === 'full') {
      setCartFull(true);
      setAdded(null);
      return;
    }
    setCartFull(false);
    setAdded({ name: nameFor(product, lang), options: optionNames(product, selection, lang) });
  };

  return (
    <ProductDetailView
      product={product}
      lang={lang}
      links={links}
      selection={selection}
      variant={variant}
      pickedImage={pickedImage}
      quantity={quantity}
      minQuantity={1}
      maxQuantity={MAX_LINE_QUANTITY}
      added={added}
      cartFull={cartFull}
      onSelect={onSelect}
      onPickImage={setPickedImage}
      onQuantityText={(text) => setQuantity(text.replace(/[^0-9]/g, '').slice(0, 3))}
      onQuantityCommit={commitQuantity}
      onStep={(delta) => setQuantity(String(clampQuantity((Math.round(Number(quantity)) || 1) + delta)))}
      onAdd={onAdd}
    />
  );
}
