/**
 * The catalogue a published site reads (part 2, session W2; PRD V1.1
 * "Catalogue"), live from Product & Services with Organization Setup's rate
 * and unit names, through Web Studio's service keys and the site's
 * organization. The rules are lib/platform/catalogue-rules.ts.
 *
 * One read of a site's catalogue is:
 *   1. GET /items?channel=ecommerce&status=ACTIVE (every page) and the category tree;
 *   2. the variants workspace of each parent in the site's categories, and the
 *      unit names of the candidates (Organization Setup);
 *   3. the day's USD→IQD rate, only when something is priced in the other currency.
 * The eligibility filters (price, rate, categories with their subtrees,
 * variants) cannot be asked of Product & Services, so a page of the grid is cut
 * from the whole catalogue here. The read is kept 60 seconds per site, one read
 * at a time per site, and is read again at once when the store settings change
 * (`forgetCatalogue`, called by lib/platform/store-settings.ts). A failed read
 * is not kept.
 *
 * Errors: a service that cannot be asked throws its own error
 * (ProductServicesUnavailableError, OrgSetupUnavailableError,
 * StoreMediaUnavailableError); lib/platform/store-api.ts answers 503 with a
 * stable code for each.
 */

import path from 'path';
import { catalogueEntries } from '@/lib/platform/catalogue-cache';
import {
  buildCatalogue,
  candidatesOf,
  categorySummaries,
  needsRate,
  pageOf,
  showsImage,
  withImages,
  type Catalogue,
  type PageQuery,
  type StoreCategorySummary,
  type StoreProduct,
} from '@/lib/platform/catalogue-rules';
import { currentFileHash, downloadDocumentFile } from '@/lib/platform/document-center';
import { mapLimit } from '@/lib/platform/map-limit';
import { findUnits, usdIqdRate } from '@/lib/platform/org-setup';
import { getCategoryTree, getVariantWorkspace, listEcommerceItems, listItemImages, type ItemImage } from '@/lib/platform/product-services';
import type { Site } from '@/lib/platform/site';
import { STORAGE_DIR } from '@/lib/platform/storage';
import { createStoreMediaCache, type MediaFile, type StoreMediaCache } from '@/lib/platform/store-media';
import { rateDay } from '@/lib/platform/store-money';
import { storeOf } from '@/lib/platform/store-settings';
import type { StoreRow } from '@/lib/platform/store-settings-input';

/** Parents whose workspaces are read at once. */
const WORKSPACE_CONCURRENCY = 6;

interface Snapshot {
  organizationId: string;
  catalogue: Catalogue;
  /** Each product's images, read the first time its page or one of its images asks (and kept with the snapshot). */
  galleries: Map<string, Promise<ItemImage[] | null>>;
}

async function read(site: Site, store: StoreRow): Promise<Snapshot> {
  const org = site.organization_id;
  const [items, tree] = await Promise.all([listEcommerceItems(org), getCategoryTree(org)]);
  const candidates = candidatesOf(items, tree, store.category_ids);
  const parents = candidates.filter((item) => item.has_variants);
  const [workspaceList, units] = await Promise.all([
    mapLimit(parents, WORKSPACE_CONCURRENCY, (parent) => getVariantWorkspace(org, parent.id)),
    findUnits(org, candidates.flatMap((item) => (item.base_uom_id ? [item.base_uom_id] : []))),
  ]);
  const priced = [...candidates.filter((item) => !item.has_variants), ...workspaceList.flatMap((workspace) => workspace?.variants ?? [])];
  const rate = needsRate(priced, store.currency) ? await usdIqdRate(org, rateDay(new Date())) : null;
  const catalogue = buildCatalogue({
    items,
    workspaces: new Map(parents.map((parent, i) => [parent.id, workspaceList[i]])),
    tree,
    store: { currency: store.currency, category_ids: store.category_ids },
    rate,
    units,
  });
  return { organizationId: org, catalogue, galleries: new Map() };
}

async function snapshotOf(site: Site): Promise<Snapshot> {
  const store = await storeOf(site.id);
  const fingerprint = `${store.currency}|${store.category_ids.join(',')}`;
  const entries = catalogueEntries();
  const kept = entries.get(site.id);
  if (kept && kept.fingerprint === fingerprint) return kept.value as Promise<Snapshot>;
  const value = read(site, store);
  entries.set(site.id, { fingerprint, value });
  // A failed read is not kept: the next request asks again. The caller still sees the failure.
  value.catch(() => {
    if (entries.get(site.id)?.value === value) entries.forget(site.id);
  });
  return value;
}

function galleryOf(snapshot: Snapshot, productId: string): Promise<ItemImage[] | null> {
  let gallery = snapshot.galleries.get(productId);
  if (!gallery) {
    gallery = listItemImages(snapshot.organizationId, productId);
    snapshot.galleries.set(productId, gallery);
    const kept = gallery;
    kept.catch(() => {
      if (snapshot.galleries.get(productId) === kept) snapshot.galleries.delete(productId);
    });
  }
  return gallery;
}

/** One page of the site's products, as the grid shows them (the primary image only). */
export async function listProducts(site: Site, query: PageQuery): Promise<{ products: StoreProduct[]; total: number }> {
  return pageOf((await snapshotOf(site)).catalogue, query);
}

/** One product the site sells, with every image it has; null when it is not on sale here (or is a variant, never a product). */
export async function getProduct(site: Site, itemId: string): Promise<StoreProduct | null> {
  const snapshot = await snapshotOf(site);
  const product = snapshot.catalogue.byId.get(itemId);
  if (!product) return null;
  const gallery = await galleryOf(snapshot, itemId);
  return gallery === null ? null : withImages(product, gallery);
}

/** The site's whole catalogue, the one its pages read: the checkout checks a cart against it (session W3). */
export async function siteCatalogue(site: Site): Promise<Catalogue> {
  return (await snapshotOf(site)).catalogue;
}

/** The shop home's categories with what the site sells in each. */
export async function listCategories(site: Site): Promise<StoreCategorySummary[]> {
  return categorySummaries((await snapshotOf(site)).catalogue);
}

const globalForMedia = globalThis as unknown as { __webStudioStoreMedia?: StoreMediaCache };
const media = (): StoreMediaCache =>
  (globalForMedia.__webStudioStoreMedia ??= createStoreMediaCache({
    dir: path.join(STORAGE_DIR, '_store-media'),
    source: { download: downloadDocumentFile, currentHash: currentFileHash },
  }));

/**
 * An image of a product the site sells: the product's own, a variant's, or one
 * of the product's images. Anything else is null, so no other document of the
 * organization is ever fetched through a site's host.
 */
export async function storeImage(site: Site, productId: string, documentId: string): Promise<MediaFile | null> {
  const snapshot = await snapshotOf(site);
  const product = snapshot.catalogue.byId.get(productId);
  if (!product) return null;
  if (!showsImage(product, documentId, null) && !showsImage(product, documentId, await galleryOf(snapshot, productId))) return null;
  return media().get(snapshot.organizationId, documentId);
}
