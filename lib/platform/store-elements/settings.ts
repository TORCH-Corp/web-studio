/**
 * What a store element keeps in its layer's settings (part 2, session W4; PRD
 * V1.1 "Store elements and sections"), and how it is read back.
 *
 * The three elements are leaves: the builder styles their wrapper, the inside
 * is the store pages' own design (handoff/store/DESIGN_SYSTEM.md). Their
 * settings live in `layer.settings.store`, one key of ycode's LayerSettings,
 * so a layer saved by another version, or by hand, is still read safely: every
 * reader here returns a complete, valid value.
 *
 * Kept free of Next and React imports so it runs under `node --test`.
 */

import { DEFAULT_PAGE_SIZE, MAX_CATEGORIES, MAX_PAGE_SIZE, isUuid } from '@/lib/platform/store-query';

/** Layer names of the elements this module owns (keys of lib/templates/store.ts). */
export const STORE_ELEMENT_NAMES = ['productGrid', 'productCard', 'cartIndicator'] as const;
export type StoreElementName = (typeof STORE_ELEMENT_NAMES)[number];

export function isStoreElement(name: string | undefined | null): name is StoreElementName {
  return !!name && (STORE_ELEMENT_NAMES as readonly string[]).includes(name);
}

export interface ProductGridSettings {
  /** Category ids the grid lists, with what is under them; empty lists everything the site sells. */
  categories: string[];
  /** Products per page, 1 to 48: the first page is this many and "Load more" adds this many. */
  pageSize: number;
  showSearch: boolean;
  showCategoryFilter: boolean;
  /** The page's ?category= selects that category. */
  honourUrlCategory: boolean;
}

/** The product a lone card shows, with the names the builder saw when it was picked (for the canvas label only). */
export interface ChosenProduct {
  id: string;
  name: string;
  name_ar: string | null;
}

export interface ProductCardSettings {
  product: ChosenProduct | null;
}

/** `layer.settings.store`. */
export interface StoreElementSettings {
  productGrid?: Partial<ProductGridSettings>;
  productCard?: Partial<ProductCardSettings>;
}

export const PRODUCT_GRID_DEFAULTS: ProductGridSettings = {
  categories: [],
  pageSize: DEFAULT_PAGE_SIZE,
  showSearch: true,
  showCategoryFilter: true,
  honourUrlCategory: true,
};

type WithStore = { settings?: { store?: StoreElementSettings } } | null | undefined;

function flag(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

/** A page size as a whole number from 1 to 48; anything else is the default (12), a number out of range is pulled in. */
export function clampPageSize(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_PAGE_SIZE;
  return Math.min(MAX_PAGE_SIZE, Math.max(1, Math.round(value)));
}

/** Category ids as the products route takes them: valid ids, lower case, once each, at most 24. */
export function cleanCategoryIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const ids = value.filter((id): id is string => typeof id === 'string' && isUuid(id)).map((id) => id.toLowerCase());
  return [...new Set(ids)].slice(0, MAX_CATEGORIES);
}

export function readProductGridSettings(layer: WithStore): ProductGridSettings {
  const stored = layer?.settings?.store?.productGrid;
  return {
    categories: cleanCategoryIds(stored?.categories),
    pageSize: stored?.pageSize === undefined ? PRODUCT_GRID_DEFAULTS.pageSize : clampPageSize(stored.pageSize),
    showSearch: flag(stored?.showSearch, PRODUCT_GRID_DEFAULTS.showSearch),
    showCategoryFilter: flag(stored?.showCategoryFilter, PRODUCT_GRID_DEFAULTS.showCategoryFilter),
    honourUrlCategory: flag(stored?.honourUrlCategory, PRODUCT_GRID_DEFAULTS.honourUrlCategory),
  };
}

export function readProductCardSettings(layer: WithStore): ProductCardSettings {
  const product = layer?.settings?.store?.productCard?.product;
  if (!product || typeof product.id !== 'string' || !isUuid(product.id)) return { product: null };
  return {
    product: {
      id: product.id.toLowerCase(),
      name: typeof product.name === 'string' ? product.name : '',
      name_ar: typeof product.name_ar === 'string' ? product.name_ar : null,
    },
  };
}
