'use client';

import React, { useLayoutEffect } from 'react';
import { nameFor } from '@/lib/platform/store-elements/card-data';
import Cart from '@/lib/platform/store-elements/Cart';
import { CartView } from '@/lib/platform/store-elements/CartView';
import { connectBrowserCart, MAX_LINE_QUANTITY } from '@/lib/platform/store-elements/cart-store';
import Checkout from '@/lib/platform/store-elements/Checkout';
import { CheckoutView } from '@/lib/platform/store-elements/CheckoutView';
import { ConfirmationView } from '@/lib/platform/store-elements/ConfirmationView';
import { EMPTY_FORM } from '@/lib/platform/store-elements/checkout-form';
import { storeColourStyle } from '@/lib/platform/store-elements/colours';
import CartIndicator, { CartIndicatorView } from '@/lib/platform/store-elements/CartIndicator';
import { ProductCardView } from '@/lib/platform/store-elements/CardView';
import { ProductGridView } from '@/lib/platform/store-elements/GridView';
import { createStoreLinks } from '@/lib/platform/store-elements/links';
import { summarise } from '@/lib/platform/store-elements/order-summary';
import OrderConfirmation from '@/lib/platform/store-elements/OrderConfirmation';
import type { LineView } from '@/lib/platform/store-elements/OrderLines';
import { parseStorePagePaths, type StorePageContext } from '@/lib/platform/store-elements/pages';
import { variantFor } from '@/lib/platform/store-elements/picker';
import ProductCardElement from '@/lib/platform/store-elements/ProductCardElement';
import ProductDetail from '@/lib/platform/store-elements/ProductDetail';
import { ProductDetailView } from '@/lib/platform/store-elements/ProductDetailView';
import ProductGrid from '@/lib/platform/store-elements/ProductGrid';
import { SAMPLE_CART_COUNT, SAMPLE_CART_LINES, SAMPLE_CATEGORIES, SAMPLE_SELECTION, SAMPLE_TERMS, sampleCard, sampleCards, sampleOrder, sampleProduct } from '@/lib/platform/store-elements/sample-data';
import { readProductCardSettings, readProductDetailSettings, readProductGridSettings, type StoreElementName } from '@/lib/platform/store-elements/settings';
import { StoreShell } from '@/lib/platform/store-elements/StoreShell';
import { storeLangOf } from '@/lib/platform/store-elements/strings';
import type { Layer, Locale } from '@/types';

type WrapperProps = Record<string, unknown> & { className?: string; style?: React.CSSProperties };

interface Props {
  layer: Layer;
  /** What the renderer would put on the layer's element: its classes, style, data attributes and, on the canvas, its handlers. */
  elementProps: WrapperProps;
  /** The site's colour variables (id and name): the store's three are found among them by name. */
  colorVariables?: ReadonlyArray<{ id: string; name: string }>;
  locale?: Locale | null;
  /** `serverSettings.store` on a published page (lib/platform/store-elements/pages.ts); absent in the builder. */
  store?: StorePageContext;
}

const noop = () => {};

/** The canvas's cart and checkout: the handoff's three lines and its amounts, with nothing to find out about them. */
function sampleCart(links: ReturnType<typeof createStoreLinks>) {
  const summary = summarise(SAMPLE_CART_LINES, SAMPLE_TERMS);
  if (summary.kind !== 'ready') throw new Error('The sample cart has no summary: its lines and the sample terms must agree on the currency');
  const lines: LineView[] = summary.lines.map((row) => ({ line: row.line, href: links.product(row.line.product_id), total: row.total, changedFrom: null, unavailable: false }));
  return { lines, count: summary.count, amounts: { subtotal: summary.subtotal, fee: summary.fee, total: summary.total } };
}

/**
 * A store element on a published page: the live element, in the page's language and direction, wearing the
 * layer's own classes and style. The HTML string path (static export, filter HTML) is lib/platform/store-elements/html.ts.
 */
export function PublishedStoreElement({ layer, elementProps, colorVariables, locale, store }: Props) {
  const lang = storeLangOf(locale?.code);
  const name = layer.name as StoreElementName;
  const links = createStoreLinks(locale ?? null, store?.pages ?? {});
  const siteId = store?.site_id;
  // Before the elements' own effects subscribe to the cart (a layout effect runs ahead of every effect below it), so
  // the first count they read is the buyer's, not an empty cart that then jumps.
  useLayoutEffect(() => {
    if (siteId) connectBrowserCart(siteId);
  }, [siteId]);

  let inside: React.ReactNode = null;
  if (name === 'productGrid') inside = <ProductGrid
    settings={readProductGridSettings(layer)} lang={lang}
    links={links}
                                       />;
  else if (name === 'productCard') {
    const { product } = readProductCardSettings(layer);
    // A card with nothing chosen has nothing to show on a published page.
    if (!product) return null;
    inside = <ProductCardElement
      productId={product.id} lang={lang}
      links={links}
             />;
  } else if (name === 'productDetail') {
    const chosen = readProductDetailSettings(layer).product;
    // On the page with the product role the URL names the item; anywhere else the builder's choice does, and with
    // neither there is nothing to show.
    if (!store?.product && !chosen) return null;
    inside = <ProductDetail
      lang={lang} links={links}
      pageProduct={store?.product} chosenProductId={chosen?.id ?? null}
             />;
  } else if (name === 'cartIndicator') inside = <CartIndicator lang={lang} links={links} />;
  else if (name === 'cart') inside = <Cart lang={lang} links={links} />;
  else if (name === 'checkout') inside = <Checkout lang={lang} links={links} />;
  else if (name === 'orderConfirmation') inside = <OrderConfirmation lang={lang} links={links} />;
  return (
    <StoreShell
      {...elementProps} element={name}
      lang={lang} colours={storeColourStyle(colorVariables)}
    >
      {inside}
    </StoreShell>
  );
}

/**
 * A store element in the builder canvas: sample data as the handoff draws it, never a call to the store API.
 * In edit mode the inside takes no pointer events, so a click selects the layer like any other.
 */
export function CanvasStoreElement({ layer, elementProps, colorVariables, locale, inert }: Props & { inert: boolean }) {
  const lang = storeLangOf(locale?.code);
  const name = layer.name as StoreElementName;
  // The canvas links nowhere that matters (an inert click selects the layer); the conventional paths are enough.
  const links = createStoreLinks(locale ?? null, parseStorePagePaths(null));
  let inside: React.ReactNode = null;
  if (name === 'productGrid') {
    const settings = readProductGridSettings(layer);
    inside = (
      <ProductGridView
        lang={lang}
        links={links}
        phase={{ kind: 'ready', cards: sampleCards(settings.pageSize), hasMore: false, loadingMore: false, moreFailed: false }}
        showSearch={settings.showSearch}
        showCategoryFilter={settings.showCategoryFilter}
        chips={SAMPLE_CATEGORIES.map((category) => ({ id: category.id, name: nameFor(category, lang) }))}
        selectedCategory={null}
        typed=""
        query=""
        skeletons={0}
        onTyped={noop}
        onSubmitSearch={noop}
        onSelectCategory={noop}
        onClearSearch={noop}
        onLoadMore={noop}
        onRetry={noop}
        onAdd={noop}
      />
    );
  } else if (name === 'productCard') {
    const { product } = readProductCardSettings(layer);
    // A product that was chosen shows under its own name; the price and the picture are the sample's.
    const sample = sampleCard();
    const card = product ? { ...sample, id: product.id, name: product.name || sample.name, name_ar: product.name_ar ?? (product.name ? null : sample.name_ar) } : sample;
    inside = <ProductCardView
      card={card} lang={lang}
      href={links.product(card.id)} onAdd={noop}
             />;
  } else if (name === 'productDetail') {
    const product = sampleProduct();
    // A product that was chosen shows under its own name; everything else is the sample's.
    const { product: chosen } = readProductDetailSettings(layer);
    const shown = chosen ? { ...product, name: chosen.name || product.name, name_ar: chosen.name_ar ?? (chosen.name ? null : product.name_ar) } : product;
    inside = (
      <ProductDetailView
        product={shown} lang={lang}
        links={links} selection={SAMPLE_SELECTION}
        variant={variantFor(shown, SAMPLE_SELECTION)} pickedImage={null}
        quantity="1" minQuantity={1}
        maxQuantity={MAX_LINE_QUANTITY} added={null}
        cartFull={false} onSelect={noop}
        onPickImage={noop} onQuantityText={noop}
        onQuantityCommit={noop} onStep={noop}
        onAdd={noop}
      />
    );
  } else if (name === 'cartIndicator') {
    inside = <CartIndicatorView
      count={SAMPLE_CART_COUNT} lang={lang}
      href={links.cart()}
             />;
  } else if (name === 'cart') {
    const sample = sampleCart(links);
    inside = (
      <CartView
        lang={lang} links={links}
        phase="ready" lines={sample.lines}
        count={sample.count} summary={sample.amounts}
        pricesNotChecked={false} blocked={false}
        unavailableCount={0} onQuantity={noop}
        onRemove={noop} onRetry={noop}
        onRetryPrices={noop}
      />
    );
  } else if (name === 'checkout') {
    const sample = sampleCart(links);
    inside = (
      <CheckoutView
        lang={lang} links={links}
        phase="ready" lines={sample.lines}
        count={sample.count} summary={sample.amounts}
        values={EMPTY_FORM} errors={{ fields: {}, general: [] }}
        banner={null} submitting={false}
        blocked={false} unavailableCount={0}
        onChange={noop} onSubmit={noop}
        onRemove={noop} onRemoveUnavailable={noop}
        onRetry={noop}
      />
    );
  } else if (name === 'orderConfirmation') {
    inside = (
      <ConfirmationView
        lang={lang} links={links}
        phase={{ kind: 'ready', order: sampleOrder() }}
        onRetry={noop}
      />
    );
  }
  return (
    <StoreShell
      {...elementProps} element={name}
      lang={lang} colours={storeColourStyle(colorVariables)}
    >
      {inert ? <div style={{ pointerEvents: 'none' }}>{inside}</div> : inside}
    </StoreShell>
  );
}
