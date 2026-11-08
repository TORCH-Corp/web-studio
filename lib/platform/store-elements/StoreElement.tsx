'use client';

import React from 'react';
import { nameFor } from '@/lib/platform/store-elements/card-data';
import { storeColourStyle } from '@/lib/platform/store-elements/colours';
import CartIndicator, { CartIndicatorView } from '@/lib/platform/store-elements/CartIndicator';
import { ProductCardView } from '@/lib/platform/store-elements/CardView';
import { ProductGridView } from '@/lib/platform/store-elements/GridView';
import { cartHref, productHref } from '@/lib/platform/store-elements/links';
import ProductCardElement from '@/lib/platform/store-elements/ProductCardElement';
import ProductGrid from '@/lib/platform/store-elements/ProductGrid';
import { SAMPLE_CART_COUNT, SAMPLE_CATEGORIES, sampleCard, sampleCards } from '@/lib/platform/store-elements/sample-data';
import { readProductCardSettings, readProductGridSettings, type StoreElementName } from '@/lib/platform/store-elements/settings';
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
}

const noop = () => {};

/**
 * A store element on a published page: the live element, in the page's language and direction, wearing the
 * layer's own classes and style. The HTML string path (static export, filter HTML) is lib/platform/store-elements/html.ts.
 */
export function PublishedStoreElement({ layer, elementProps, colorVariables, locale }: Props) {
  const lang = storeLangOf(locale?.code);
  const name = layer.name as StoreElementName;
  const link = locale ?? null;
  let inside: React.ReactNode = null;
  if (name === 'productGrid') inside = <ProductGrid
    settings={readProductGridSettings(layer)} lang={lang}
    locale={link}
                                       />;
  else if (name === 'productCard') {
    const { product } = readProductCardSettings(layer);
    // A card with nothing chosen has nothing to show on a published page.
    if (!product) return null;
    inside = <ProductCardElement
      productId={product.id} lang={lang}
      locale={link}
             />;
  } else if (name === 'cartIndicator') inside = <CartIndicator lang={lang} locale={link} />;
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
  const link = locale ?? null;
  let inside: React.ReactNode = null;
  if (name === 'productGrid') {
    const settings = readProductGridSettings(layer);
    inside = (
      <ProductGridView
        lang={lang}
        locale={link}
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
      href={productHref(card.id, link)} onAdd={noop}
             />;
  } else if (name === 'cartIndicator') {
    inside = <CartIndicatorView
      count={SAMPLE_CART_COUNT} lang={lang}
      href={cartHref(link)}
             />;
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
