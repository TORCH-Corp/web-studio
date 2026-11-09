/**
 * The store elements as an HTML string (part 2, session W4): the third render
 * path, `layerToHtml`, which the static export and the filter and load-more
 * routes use. There is no script here to fetch with and the data is live, so an
 * element is its shell: the wrapper with the layer's own attributes, the
 * stylesheet and font, and the loading state (the product grid and card draw
 * their skeleton, the product page, the cart, the checkout, the confirmation
 * and the category cards their own, the cart indicator its empty cart).
 *
 * Kept free of Next and React imports so it runs under `node --test`.
 */

import { escapeHtml } from '@/lib/escape-html';
import { STORE_FONT_CSS_URL } from '@/lib/platform/store-elements/fonts';
import { createStoreLinks, type LinkLocale } from '@/lib/platform/store-elements/links';
import { readProductGridSettings, type StoreElementName } from '@/lib/platform/store-elements/settings';
import { STORE_CSS } from '@/lib/platform/store-elements/styles';
import { STORE_STRINGS, storeDirOf, storeLangOf } from '@/lib/platform/store-elements/strings';

/** Skeleton cards the grid shell draws: the handoff's eight. */
const SKELETON_COUNT = 8;

const SKELETON_CARD = '<div class="ws-card"><div class="ws-sk ws-sk-media"></div><div class="ws-sk ws-sk-line"></div><div class="ws-sk ws-sk-line ws-sk-short"></div><div class="ws-sk ws-sk-btn"></div></div>';

/** The product page element's loading state: the same blocks as ProductDetailSkeleton. */
const detailSkeleton = (loading: string) =>
  `<div class="ws-crumbs" aria-hidden="true"><div class="ws-sk ws-sk-line ws-sk-crumbs"></div></div><div class="ws-pd" aria-busy="true"><p class="ws-sr" role="status">${escapeHtml(loading)}</p><div class="ws-gallery" aria-hidden="true"><div class="ws-sk ws-sk-media"></div><div class="ws-thumbs">${'<div class="ws-sk ws-sk-thumb"></div>'.repeat(4)}</div></div><div class="ws-info" aria-hidden="true"><div class="ws-sk ws-sk-title"></div><div class="ws-sk ws-sk-line ws-sk-short"></div><div class="ws-sk ws-sk-title ws-sk-short"></div><div class="ws-sk-chips">${'<div class="ws-sk ws-sk-chip"></div>'.repeat(4)}</div><div class="ws-sk ws-sk-btn"></div></div></div>`;

const SKELETON_ROW = '<div class="ws-sk-row"><div class="ws-sk ws-sk-square"></div><div class="ws-stack-2"><div class="ws-sk ws-sk-line"></div><div class="ws-sk ws-sk-line ws-sk-short"></div></div></div>';

/** The cart element's loading state: the same blocks as CartSkeleton. */
const cartSkeleton = (t: (typeof STORE_STRINGS)['en']) =>
  `<div class="ws-cart-page" aria-busy="true"><p class="ws-sr" role="status">${escapeHtml(t.loadingCart)}</p><div class="ws-page-head" aria-hidden="true"><h1 class="ws-h1">${escapeHtml(t.cartTitle)}</h1></div><div class="ws-cart-layout" aria-hidden="true"><div class="ws-lines">${SKELETON_ROW.repeat(3)}</div><div class="ws-sk ws-sk-panel"></div></div></div>`;

/** The checkout element's loading state: the same blocks as CheckoutSkeleton. */
const checkoutSkeleton = (t: (typeof STORE_STRINGS)['en']) =>
  `<div class="ws-checkout-page" aria-busy="true"><p class="ws-sr" role="status">${escapeHtml(t.loadingCheckout)}</p><div class="ws-page-head" aria-hidden="true"><h1 class="ws-h1">${escapeHtml(t.checkout)}</h1></div><div class="ws-cart-layout" aria-hidden="true"><div class="ws-co-main">${'<div class="ws-sk ws-sk-block"></div>'.repeat(4)}</div><div class="ws-sk ws-sk-panel"></div></div></div>`;

/** The confirmation element's loading state: the same blocks as ConfirmationSkeleton. */
const confirmationSkeleton = (t: (typeof STORE_STRINGS)['en']) =>
  `<div class="ws-conf" aria-busy="true"><p class="ws-sr" role="status">${escapeHtml(t.loadingOrder)}</p><div class="ws-conf-head" aria-hidden="true"><div class="ws-sk ws-sk-square" style="width:var(--ws-size-icon-xl);border-radius:var(--ws-radius-full)"></div><div class="ws-sk ws-sk-title" style="width:60%"></div></div><div class="ws-sk ws-sk-block" aria-hidden="true"></div><div class="ws-sk ws-sk-panel" aria-hidden="true"></div></div>`;

/** The category cards' loading state: the same blocks as CategoryCardsSkeleton. */
const categoryCardsSkeleton = (loading: string) =>
  `<div class="ws-cats" aria-busy="true"><p class="ws-sr" role="status">${escapeHtml(loading)}</p>${'<div class="ws-cat-card" aria-hidden="true"><div class="ws-sk ws-sk-media ws-ph-cat"></div><div class="ws-sk ws-sk-line ws-sk-short"></div></div>'.repeat(3)}</div>`;

const BAG = '<svg class="ws-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 7h12l-1 13H7L6 7z"></path><path d="M9 7a3 3 0 0 1 6 0"></path></svg>';

/** The attributes with `ws-store` added to the class (or a class made), so the element's stylesheet applies. */
function withStoreClass(attrs: string[]): string[] {
  const index = attrs.findIndex((attr) => attr.startsWith('class="'));
  if (index === -1) return ['class="ws-store"', ...attrs];
  return attrs.map((attr, i) => (i === index ? `${attr.slice(0, -1)} ws-store"` : attr));
}

export interface StoreHtmlInput {
  layer: { name: string; settings?: unknown };
  /** The attributes layerToHtml built for the layer (class, data-layer-id, style, custom attributes), as `name="value"` strings. */
  attrs: string[];
  locale?: (LinkLocale & { code: string }) | null;
  /** The static export: a standalone page with no platform behind it, so no font to ask the platform for. */
  staticExport?: boolean;
}

/** The element's HTML; an empty string for a layer that is not a store element. */
export function storeElementHtml({ layer, attrs, locale, staticExport = false }: StoreHtmlInput): string {
  const name = layer.name as StoreElementName;
  const lang = storeLangOf(locale?.code);
  const t = STORE_STRINGS[lang];

  let inside: string;
  if (name === 'productGrid') {
    const { pageSize, showCount } = readProductGridSettings(layer as never);
    // The count's line, empty until the count is known, as the published grid first draws it.
    const count = showCount ? '<p class="ws-muted ws-count" aria-hidden="true">&nbsp;</p>' : '';
    inside = `<div class="ws-grid-root">${count}<p class="ws-sr" role="status">${escapeHtml(t.loading)}</p><div class="ws-grid" aria-hidden="true">${SKELETON_CARD.repeat(Math.min(pageSize, SKELETON_COUNT))}</div></div>`;
  } else if (name === 'productCard') {
    // Picked or not, the card first draws its skeleton: an unpicked one shows one of the store's first products (featured.ts).
    inside = `<p class="ws-sr" role="status">${escapeHtml(t.loading)}</p><div aria-hidden="true">${SKELETON_CARD}</div>`;
  } else if (name === 'productDetail') {
    inside = detailSkeleton(t.loadingProduct);
  } else if (name === 'cart') {
    inside = cartSkeleton(t);
  } else if (name === 'checkout') {
    inside = checkoutSkeleton(t);
  } else if (name === 'orderConfirmation') {
    inside = confirmationSkeleton(t);
  } else if (name === 'categoryCards') {
    inside = categoryCardsSkeleton(t.loadingCategories);
  } else if (name === 'cartIndicator') {
    inside = `<a class="ws-cart" href="${escapeHtml(createStoreLinks(locale, {}).cart())}" aria-label="${escapeHtml(t.cartEmpty)}">${BAG}<span class="ws-cart-label" aria-hidden="true">${escapeHtml(t.cartLabel)}</span></a>`;
  } else {
    return '';
  }

  const all = [...withStoreClass(attrs), `data-ws-store="${name}"`, `dir="${storeDirOf(lang)}"`, `lang="${lang}"`];
  const font = staticExport ? '' : `<link rel="stylesheet" href="${STORE_FONT_CSS_URL}">`;
  return `<div ${all.join(' ')}>${font}<style>${STORE_CSS}</style>${inside}</div>`;
}
