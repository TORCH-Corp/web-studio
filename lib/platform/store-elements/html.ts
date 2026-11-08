/**
 * The store elements as an HTML string (part 2, session W4): the third render
 * path, `layerToHtml`, which the static export and the filter and load-more
 * routes use. There is no script here to fetch with and the data is live, so an
 * element is its shell: the wrapper with the layer's own attributes, the
 * stylesheet and font, and the loading state (the product grid and card draw
 * their skeleton, the product page its own, the cart indicator its empty cart).
 *
 * Kept free of Next and React imports so it runs under `node --test`.
 */

import { escapeHtml } from '@/lib/escape-html';
import { STORE_FONT_CSS_URL } from '@/lib/platform/store-elements/fonts';
import { createStoreLinks, type LinkLocale } from '@/lib/platform/store-elements/links';
import { readProductCardSettings, readProductGridSettings, type StoreElementName } from '@/lib/platform/store-elements/settings';
import { STORE_CSS } from '@/lib/platform/store-elements/styles';
import { STORE_STRINGS, storeDirOf, storeLangOf } from '@/lib/platform/store-elements/strings';

/** Skeleton cards the grid shell draws: the handoff's eight. */
const SKELETON_COUNT = 8;

const SKELETON_CARD = '<div class="ws-card"><div class="ws-sk ws-sk-media"></div><div class="ws-sk ws-sk-line"></div><div class="ws-sk ws-sk-line ws-sk-short"></div><div class="ws-sk ws-sk-btn"></div></div>';

/** The product page element's loading state: the same blocks as ProductDetailSkeleton. */
const detailSkeleton = (loading: string) =>
  `<div class="ws-pd" aria-busy="true"><p class="ws-sr" role="status">${escapeHtml(loading)}</p><div class="ws-gallery" aria-hidden="true"><div class="ws-sk ws-sk-media"></div><div class="ws-thumbs">${'<div class="ws-sk ws-sk-thumb"></div>'.repeat(4)}</div></div><div class="ws-info" aria-hidden="true"><div class="ws-sk ws-sk-title"></div><div class="ws-sk ws-sk-line ws-sk-short"></div><div class="ws-sk ws-sk-title ws-sk-short"></div><div class="ws-sk-chips">${'<div class="ws-sk ws-sk-chip"></div>'.repeat(4)}</div><div class="ws-sk ws-sk-btn"></div></div></div>`;

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

/** The element's HTML; an empty string for a lone card with no product chosen (it renders nothing on the published page either). */
export function storeElementHtml({ layer, attrs, locale, staticExport = false }: StoreHtmlInput): string {
  const name = layer.name as StoreElementName;
  const lang = storeLangOf(locale?.code);
  const t = STORE_STRINGS[lang];

  let inside: string;
  if (name === 'productGrid') {
    const { pageSize } = readProductGridSettings(layer as never);
    inside = `<div class="ws-grid-root"><p class="ws-sr" role="status">${escapeHtml(t.loading)}</p><div class="ws-grid" aria-hidden="true">${SKELETON_CARD.repeat(Math.min(pageSize, SKELETON_COUNT))}</div></div>`;
  } else if (name === 'productCard') {
    if (!readProductCardSettings(layer as never).product) return '';
    inside = `<p class="ws-sr" role="status">${escapeHtml(t.loading)}</p><div aria-hidden="true">${SKELETON_CARD}</div>`;
  } else if (name === 'productDetail') {
    inside = detailSkeleton(t.loadingProduct);
  } else if (name === 'cartIndicator') {
    inside = `<a class="ws-cart" href="${escapeHtml(createStoreLinks(locale, {}).cart())}" aria-label="${escapeHtml(t.cartEmpty)}">${BAG}<span class="ws-cart-label" aria-hidden="true">${escapeHtml(t.cartLabel)}</span></a>`;
  } else {
    return '';
  }

  const all = [...withStoreClass(attrs), `data-ws-store="${name}"`, `dir="${storeDirOf(lang)}"`, `lang="${lang}"`];
  const font = staticExport ? '' : `<link rel="stylesheet" href="${STORE_FONT_CSS_URL}">`;
  return `<div ${all.join(' ')}>${font}<style>${STORE_CSS}</style>${inside}</div>`;
}
