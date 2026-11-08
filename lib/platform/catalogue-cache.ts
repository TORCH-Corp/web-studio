/**
 * Where each site's catalogue is kept for 60 seconds (part 2, session W2), in
 * its own module so the store settings can forget a site's catalogue when they
 * change without importing the catalogue's reads (lib/platform/catalogue.ts
 * imports the store settings).
 *
 * On globalThis because Next bundles every route on its own (see
 * lib/platform/site.ts). One process holds one copy; another keeps a stale
 * catalogue for at most the TTL.
 */

import { TtlCache } from '@/lib/platform/ttl-cache';

export const CATALOGUE_TTL_MS = 60_000;

/** One site's catalogue being read or read, with the store values it was read for. */
export interface CatalogueEntry {
  /** The store's currency and categories when it was read: a change reads it again. */
  fingerprint: string;
  value: Promise<unknown>;
}

const globalForCatalogues = globalThis as unknown as { __webStudioCatalogues?: TtlCache<CatalogueEntry> };

export const catalogueEntries = (): TtlCache<CatalogueEntry> =>
  (globalForCatalogues.__webStudioCatalogues ??= new TtlCache<CatalogueEntry>(CATALOGUE_TTL_MS));

/** Read the site's catalogue again on its next request (its store settings changed). */
export function forgetCatalogue(siteId: string): void {
  catalogueEntries().forget(siteId);
}
