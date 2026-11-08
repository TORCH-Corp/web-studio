import 'server-only';

import { unstable_cache } from 'next/cache';
import { buildAllPagesTag, buildRouteTag } from '@/lib/cache-tags';
import { getDocumentSlugPath } from '@/lib/document-path';
import { fetchErrorPage, fetchPageByPath, fetchPageByPathForMetadata, reassemblePageData, slimPageData, splitPageData } from '@/lib/page-fetcher';
import { runWithTenantId } from '@/lib/supabase-server';
import { resolvePathLocaleCode } from '@/lib/resolve-html-lang';
import { isStorePageRequest as isStorePagePath, type StorePagePaths } from '@/lib/platform/store-elements/pages';
import { readStorePagePaths } from '@/lib/platform/store-elements/product-page';
import type { PageData, PaginationContext } from '@/lib/page-fetcher';

export type ErrorPageCode = 401 | 404;

/** Runs `fn` with `tenantId` as the site of every lookup inside it, when there is one. */
function inSite<T>(tenantId: string | undefined, fn: () => Promise<T>): Promise<T> {
  return tenantId ? runWithTenantId(tenantId, fn) : fn();
}

/**
 * Cached lookup of the user's custom error page, invalidated on publish.
 * Shared by the 404 boundary, the page routes and their metadata so a single
 * cache entry per locale serves all of them.
 * @param slugPath - Requested path (no leading slash) whose locale the page is
 * translated into. A 404 without one uses the document path, since the
 * not-found boundary receives no route params.
 * Lookup failures resolve to null without being cached, so a transient
 * database error doesn't pin the fallback page until the next publish.
 */
export async function fetchCachedErrorPage(
  errorCode: ErrorPageCode,
  tenantId?: string,
  slugPath?: string
): Promise<PageData | null> {
  try {
    const localePath = slugPath ?? (errorCode === 404 ? getDocumentSlugPath() : undefined);
    const localeCode = localePath ? await resolvePathLocaleCode(localePath, true, tenantId) : null;

    return await unstable_cache(
      // Inside the data cache the request is out of reach: the site goes in explicitly (OPEN_QUESTIONS 27).
      async () => inSite(tenantId, async () => {
        const data = await fetchErrorPage(errorCode, true, tenantId, localeCode ?? undefined, { throwOnError: true });
        return data ? slimPageData(data) : null;
      }),
      [`error-${errorCode}`, tenantId ?? '', localeCode ?? ''],
      { tags: [buildAllPagesTag(tenantId)], revalidate: false }
    )();
  } catch (error) {
    console.error(`Failed to fetch error page ${errorCode}:`, error);
    return null;
  }
}

/**
 * How long the data of a page with a store role lives in the data cache (part 2, session W5; owner, W5 grill-me,
 * 8 Nov 2026): the catalogue's own time, so a product put on sale, repriced or gone shows within a minute and a 404
 * for an item that was not on sale does not stay until the next publish. W6 gives the cart, checkout and
 * confirmation pages the same life: a store that stops selling answers them with the site's not-found page within a
 * minute. Every other page lives until a publish purges it.
 */
export const STORE_PAGE_REVALIDATE_SECONDS = 60;

/** Where the pages with a store role live, as the last publish wrote it; purged with every page when it changes. */
async function cachedStorePagePaths(tenantId?: string): Promise<StorePagePaths> {
  try {
    return await unstable_cache(
      async () => inSite(tenantId, () => readStorePagePaths()),
      ['data-for-store-pages', tenantId ?? ''],
      { tags: [buildAllPagesTag(tenantId)], revalidate: false }
    )();
  } catch (error) {
    // A page then lives as every page does; the paths are read again on the next request.
    console.error('Failed to read the store pages:', error);
    return {};
  }
}

/** Whether the request is for a page with a store role: the product page's address (and an item), or the cart's, the checkout's or the confirmation's. */
export async function isStorePageRequest(slugPath: string, tenantId?: string): Promise<boolean> {
  return slugPath !== '' && isStorePagePath(slugPath, await cachedStorePagePaths(tenantId));
}

/** The data-cache lifetime of a page: 60 seconds for a page with a store role, until a publish for every other. */
export const pageRevalidate = (storePage: boolean): number | false => (storePage ? STORE_PAGE_REVALIDATE_SECONDS : false);

/**
 * Cached lookup of a published page and its layers, per path and site, tagged with the route and the site's
 * all-pages tag so a publish purges it. Shared by the published page route and the 404 boundary (which shows
 * the product page when an item is no longer available), so both read one entry.
 *
 * The site is passed in and the lookup runs with it as tenant context: inside an unstable_cache callback the
 * request headers are out of reach (OPEN_QUESTIONS 27).
 */
export async function fetchCachedPageWithLayers(slugPath: string, tenantId: string, storePage: boolean): Promise<PageData | null> {
  // Tags are both 'route-/X' AND 'all-pages':
  // - route-/X lets selective invalidation purge just this page's data cache
  // - all-pages lets full invalidation (color variables, redirects, etc.)
  //   sweep every page's data cache in one invalidateByTag call.
  // Vercel's invalidateByTag is tag-precise — invalidating one route's tag
  // doesn't cascade to entries that only share 'all-pages'. (Next.js bug
  // #63509 would apply if we used revalidateTag for selective, but we route
  // exclusively through invalidateByTag on Vercel.)
  const tags = [buildRouteTag(tenantId, slugPath), buildAllPagesTag(tenantId)];
  const opts = { tags, revalidate: pageRevalidate(storePage) };

  // `basePath` lets paginated collections server-render crawlable links to
  // page 2 (this route only ever renders page 1 — `p_*` params are rewritten
  // to the force-dynamic route by the proxy).
  const paginationContext: PaginationContext = { basePath: `/${slugPath}` };

  const [core, layers] = await Promise.all([
    unstable_cache(
      async () => {
        const data = await inSite(tenantId || undefined, () => fetchPageByPath(slugPath, true, paginationContext, tenantId || undefined));
        if (!data) return null;
        return splitPageData(data).core;
      },
      [`core-/${slugPath}`, tenantId],
      opts
    )(),
    unstable_cache(
      async () => {
        const data = await inSite(tenantId || undefined, () => fetchPageByPath(slugPath, true, paginationContext, tenantId || undefined));
        if (!data) return null;
        return splitPageData(data).layers;
      },
      [`layers-/${slugPath}`, tenantId],
      opts
    )(),
  ]);

  if (!core) return null;
  return reassemblePageData(core, layers || []);
}

/**
 * Cached metadata-only lookup of a published page (no layer resolution).
 * Shared by the published page route and its layout so both read one entry
 * (and so both give it the same lifetime: see STORE_PAGE_REVALIDATE_SECONDS).
 */
export async function fetchCachedPageForMetadata(
  slugPath: string,
  tenantId?: string
): Promise<PageData | null> {
  const storePage = await isStorePageRequest(slugPath, tenantId);
  return unstable_cache(
    async () => inSite(tenantId, () => fetchPageByPathForMetadata(slugPath, true, undefined, tenantId)),
    [`metadata-/${slugPath}`, tenantId ?? ''],
    { tags: [buildRouteTag(tenantId, slugPath), buildAllPagesTag(tenantId)], revalidate: pageRevalidate(storePage) }
  )();
}
