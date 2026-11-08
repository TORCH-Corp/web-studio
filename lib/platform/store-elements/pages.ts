/**
 * Store pages: a page's store role and where each role's page lives (part 2,
 * session W5; PRD V1.1 "Store elements and sections", "Store pages and
 * templates").
 *
 * A page gains a role in its settings (`PageSettings.store = { kind }`), set
 * in ycode's own page settings panel. `product` (W5): the page answers at its
 * own path and one more segment, the item's id (`/product/{itemId}`), and shows
 * that item. `cart`, `checkout` and `confirmation` (W6): ordinary pages that
 * hold the cart, the checkout and the confirmation elements, and answer the
 * site's not-found page while the store does not sell.
 *
 * "Add to cart" and the cart indicator lead the buyer to the page that holds
 * the cart, and the product card to the page that holds the product, so every
 * element needs the path of the page with a role. That is resolved once per
 * publish, not per click and not per render: the publish writes the setting
 * `store_pages` (role → path per language, `computeStorePagePaths`), the page
 * renderer hands it to the elements, and a publish that changes it renders every
 * page again so no page keeps an old link (app/(builder)/ycode/api/publish).
 *
 * Kept free of Next and React imports so it runs under `node --test`.
 */

import { buildLocalizedSlugPath, buildSlugPath, matchPageWithTranslatedSlugs } from '@/lib/page-utils';
import type { StoreProduct } from '@/lib/platform/catalogue-rules';
import type { LinkLocale } from '@/lib/platform/store-elements/links';
import { isUuid } from '@/lib/platform/store-query';
import type { Locale, Page, PageFolder, Translation } from '@/types';

/** Every role a page can have; the order is the order the panel lists them. */
export const STORE_PAGE_KINDS = ['product', 'cart', 'checkout', 'confirmation'] as const;
export type StorePageKind = (typeof STORE_PAGE_KINDS)[number];

/** The roles the page settings panel offers: all four. */
export const PANEL_PAGE_KINDS: readonly StorePageKind[] = STORE_PAGE_KINDS;

/** `PageSettings.store`. */
export interface StorePageSettings {
  kind: StorePageKind;
}

/** The setting key the publish writes. */
export const STORE_PAGES_SETTING = 'store_pages';

/** The key of the default language's path (the path of a site with no languages too). */
export const DEFAULT_PATH_KEY = '*';

/** Each role's path, per language: the default under `*`, any other under its language code with the prefix in the path. */
export type StorePagePaths = Partial<Record<StorePageKind, Record<string, string>>>;

type WithSettings = { settings?: { store?: unknown } } | null | undefined;

export function isStorePageKind(value: unknown): value is StorePageKind {
  return typeof value === 'string' && (STORE_PAGE_KINDS as readonly string[]).includes(value);
}

/** The role a page's settings give it; null for no role, or for settings that are not a role. */
export function storeKindOf(page: WithSettings): StorePageKind | null {
  const store = page?.settings?.store;
  if (typeof store !== 'object' || store === null) return null;
  const { kind } = store as { kind?: unknown };
  return isStorePageKind(kind) ? kind : null;
}

/** Only an ordinary page can have a role: a collection page, an index page and an error page have a path of their own kind. */
export function canHaveStoreRole(page: Pick<Page, 'is_dynamic' | 'is_index' | 'error_page'>): boolean {
  return !page.is_dynamic && !page.is_index && page.error_page === null;
}

const byAge = (a: Page, b: Page) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

function withRole(pages: Page[], kind: StorePageKind): Page[] {
  return pages.filter((page) => storeKindOf(page) === kind && canHaveStoreRole(page)).sort(byAge);
}

/** The page that has the role: one page each, so when two were given it the earliest (the panel stops a second, but a copied site or a hand edit can make one). */
export function pageForRole(pages: Page[], kind: StorePageKind): Page | null {
  return withRole(pages, kind)[0] ?? null;
}

/** Another page that already has the role, for the panel to name. */
export function storePageTaken(pages: Page[], kind: StorePageKind, exceptPageId: string | null): Page | null {
  return withRole(pages, kind).find((page) => page.id !== exceptPageId) ?? null;
}

// ---------------------------------------------------------------------------
// What the page renderer hands the elements
// ---------------------------------------------------------------------------

/** What the server found for the item a product page's URL names. */
export type ProductPageState =
  | { kind: 'found'; product: StoreProduct }
  /** Not on sale (unknown, inactive, no price, no rate). `item_id` is the id asked for, when it is one. */
  | { kind: 'gone'; item_id: string | null }
  /** The catalogue could not be asked just now: the element asks again in the browser. */
  | { kind: 'unknown'; item_id: string };

/** `serverSettings.store` on a published page: the site, where the pages with roles are, and on a product page the item. */
export interface StorePageContext {
  site_id: string;
  pages: StorePagePaths;
  product?: ProductPageState;
}

// ---------------------------------------------------------------------------
// What the publish writes
// ---------------------------------------------------------------------------

export interface StorePagePathsInput {
  /** The published pages. */
  pages: Page[];
  /** The published folders. */
  folders: PageFolder[];
  /** The published locales. */
  locales: Locale[];
  /** A language's translations (the slugs of pages and folders), as the page fetcher loads them. */
  translationsFor: (localeCode: string) => Record<string, Translation> | undefined;
}

export function computeStorePagePaths({ pages, folders, locales, translationsFor }: StorePagePathsInput): StorePagePaths {
  const paths: StorePagePaths = {};
  for (const kind of STORE_PAGE_KINDS) {
    const page = pageForRole(pages, kind);
    if (!page) continue;
    const perLanguage: Record<string, string> = { [DEFAULT_PATH_KEY]: buildSlugPath(page, folders, 'page') };
    for (const locale of locales) {
      if (locale.is_default) continue;
      perLanguage[locale.code] = buildLocalizedSlugPath(page, folders, 'page', locale, translationsFor(locale.code));
    }
    paths[kind] = perLanguage;
  }
  return paths;
}

/** The setting as it was stored, read back: a role keeps only the paths that are strings starting with `/`. */
export function parseStorePagePaths(value: unknown): StorePagePaths {
  const paths: StorePagePaths = {};
  if (typeof value !== 'object' || value === null) return paths;
  for (const kind of STORE_PAGE_KINDS) {
    const stored = (value as Record<string, unknown>)[kind];
    if (typeof stored !== 'object' || stored === null) continue;
    const kept: Record<string, string> = {};
    for (const [language, path] of Object.entries(stored)) {
      if (typeof path === 'string' && path.startsWith('/')) kept[language] = path;
    }
    if (Object.keys(kept).length > 0) paths[kind] = kept;
  }
  return paths;
}

/** Whether two sets of paths are the same, whatever order their keys came in. */
export function samePaths(a: StorePagePaths, b: StorePagePaths): boolean {
  const canonical = (paths: StorePagePaths) =>
    JSON.stringify(STORE_PAGE_KINDS.map((kind) => [kind, Object.entries(paths[kind] ?? {}).sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0))]));
  return canonical(a) === canonical(b);
}

// ---------------------------------------------------------------------------
// Using it
// ---------------------------------------------------------------------------

/** The path of the page with the role, in the page's language: null when no page has it. */
export function pathFor(paths: StorePagePaths, kind: StorePageKind, locale?: LinkLocale | null): string | null {
  const known = paths[kind];
  if (!known) return null;
  const base = known[DEFAULT_PATH_KEY];
  if (!locale || locale.is_default || !locale.code) return base ?? null;
  // A language added after the last publish has no path yet: the default path under the language's prefix, as every page of it is.
  return known[locale.code] ?? (base ? `/${locale.code}${base}` : null);
}

function safeDecode(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/**
 * Whether a request path (no leading slash) is for a page with a store role: the product page's own path, or its
 * path and one more segment, the item; the cart, checkout and confirmation pages' own paths. Such a request is
 * answered live (the page's data lives 60 seconds, not until the next publish): the product page because the
 * item may go on or off sale, the others because a store that stops selling answers their address with the
 * site's not-found page (PRD V1.1 "Store settings").
 */
export function isStorePageRequest(slugPath: string, paths: StorePagePaths): boolean {
  const requested = `/${safeDecode(slugPath).replace(/^\/+|\/+$/g, '')}`;
  return STORE_PAGE_KINDS.some((kind) =>
    Object.values(paths[kind] ?? {}).some((base) => {
      if (requested === base) return true;
      // Only the product page takes one more segment, the item.
      if (kind !== 'product' || !requested.startsWith(`${base}/`)) return false;
      const rest = requested.slice(base.length + 1);
      return rest.length > 0 && !rest.includes('/');
    }),
  );
}

export interface ProductPageMatch {
  page: Page;
  /** The item the URL names; null when the last segment is not an item id (the page then shows "no longer on sale"). */
  itemId: string | null;
}

/**
 * The product page a request path is for: the page with the role whose own
 * path (folders and translated slugs of the request's language included) is the
 * path but for its last segment, which is the item. `targetPath` has no
 * leading slash and no language prefix.
 */
export function matchProductPage(input: {
  targetPath: string;
  pages: Page[];
  folders: PageFolder[];
  translations: Record<string, Translation> | undefined;
}): ProductPageMatch | null {
  const segments = input.targetPath.split('/').filter(Boolean);
  if (segments.length < 2) return null;
  const rawId = safeDecode(segments[segments.length - 1]);
  const pagePath = segments.slice(0, -1).join('/');
  const page = withRole(input.pages, 'product').find((candidate) => matchPageWithTranslatedSlugs(pagePath, candidate, input.folders, input.translations));
  if (!page) return null;
  return { page, itemId: isUuid(rawId) ? rawId.toLowerCase() : null };
}
