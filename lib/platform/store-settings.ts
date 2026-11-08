/**
 * A site's store settings (part 2, session W1; PRD V1.1 "Store settings").
 *
 * One row of platform_site_store per site, made on the site's first read. The
 * row holds Web Studio's own choices (selling, currency, fee) and two kinds of
 * ids another app owns: the branch (Organization Setup) and the categories
 * (Product & Services). Their names, the branches to choose from and the
 * category tree are read live from those services on every read of the
 * settings; nothing of theirs is copied.
 *
 * Owner decisions of 8 Nov 2026 (grill-me, session W1):
 * - a chosen category covers every category under it; the counts are summed up
 *   the tree;
 * - a branch or category that is no longer available (archived or deleted in
 *   its service) is kept and shown with `available: false`; selling cannot be
 *   switched on with an unavailable branch;
 * - when a service cannot be asked, the read still answers with the stored
 *   values, `branches` or `category_tree` null and the reason in `*_error`;
 *   a change that needs that service's check answers 503;
 * - a change is checked only for what it changes;
 * - a currency change names the fee in the same request.
 *
 * Store settings are not page content: they apply to the published site at
 * once, with no publish (PRD). The published site reads them through
 * `storeOf`, which keeps each site's row for 30 seconds and forgets it when a
 * change is saved here (another process keeps it for at most 30 seconds, as
 * the host lookups of lib/platform/site.ts do).
 *
 * A template never sells: its store cannot be changed (session 4 keeps a
 * template off every host anyway).
 */

import { getKnexClient } from '@/lib/knex-client';
import type { Site } from '@/lib/platform/site';
import { findBranches, listBranches, OrgSetupUnavailableError, type Branch } from '@/lib/platform/org-setup';
import {
  getCategory,
  getCategoryTree,
  indexTree,
  ProductServicesUnavailableError,
  rollUpTree,
  type StoreCategoryNode,
} from '@/lib/platform/product-services';
import {
  normaliseFee,
  PAYMENT_METHODS,
  planStorePatch,
  STORE_CURRENCIES,
  type StoreCurrency,
  type StorePatch,
  type StoreRow,
} from '@/lib/platform/store-settings-input';
import { TtlCache } from '@/lib/platform/ttl-cache';

/** The site's branch. `available` is false when it is not an active branch any more, null when Organization Setup could not be asked. */
export interface StoreBranch {
  id: string;
  name: string | null;
  available: boolean | null;
}

/** One chosen category. `available` is false when it is archived or gone, null when Product & Services could not be asked. */
export interface StoreCategory {
  id: string;
  name: string | null;
  name_ar: string | null;
  /** The items of the category and of every category under it, every status, as Product & Services counts them; null when unavailable. */
  item_count: number | null;
  available: boolean | null;
}

export interface StoreSettings {
  selling: boolean;
  currency: StoreCurrency;
  branch: StoreBranch | null;
  /** The organization's active branches to choose from; null when Organization Setup could not be asked. */
  branches: Array<{ id: string; name: string }> | null;
  branches_error: string | null;
  /** The chosen categories, in the order they were saved. None chosen: the site sells every eligible item. */
  categories: StoreCategory[];
  /** The live category tree for the picker; null when Product & Services could not be asked. */
  category_tree: StoreCategoryNode[] | null;
  category_tree_error: string | null;
  /** Two decimals, as a string: "2500.00". */
  delivery_fee: string;
  payment_methods: Array<(typeof PAYMENT_METHODS)[number]>;
}

export type StoreSettingsErrorKind =
  | 'template'
  | 'branch_required'
  | 'fee_required'
  | 'branch_unavailable'
  | 'categories_unavailable'
  | 'org_setup_unavailable'
  | 'product_services_unavailable';

/** A change that cannot be applied; the route turns the kind into the status. */
export class StoreSettingsError extends Error {
  constructor(
    public readonly kind: StoreSettingsErrorKind,
    message: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'StoreSettingsError';
  }
}

/** The HTTP status of each kind. */
export function storeErrorStatus(kind: StoreSettingsErrorKind): number {
  switch (kind) {
    case 'template':
      return 403;
    case 'org_setup_unavailable':
    case 'product_services_unavailable':
      return 503;
    default:
      return 422;
  }
}

const TABLE = 'platform_site_store';
const COLUMNS = ['selling', 'currency', 'branch_id', 'category_ids', 'delivery_fee'] as const;

interface DbRow {
  selling: boolean;
  currency: string;
  branch_id: string | null;
  category_ids: string[] | null;
  delivery_fee: string | number;
}

function toStoreRow(siteId: string, row: DbRow): StoreRow {
  const fee = normaliseFee(row.delivery_fee);
  if (!STORE_CURRENCIES.includes(row.currency as StoreCurrency) || fee === null) {
    throw new Error(`platform_site_store row of site ${siteId} holds a currency or fee the table's checks forbid`);
  }
  return {
    selling: row.selling,
    currency: row.currency as StoreCurrency,
    branch_id: row.branch_id,
    category_ids: row.category_ids ?? [],
    delivery_fee: fee,
  };
}

/** The site's store row, made with the defaults on the first read. */
async function storeRow(siteId: string): Promise<StoreRow> {
  const knex = await getKnexClient();
  const select = () => knex(TABLE).where({ site_id: siteId }).first(...COLUMNS) as Promise<DbRow | undefined>;
  let row = await select();
  if (!row) {
    // Two first reads at once: one inserts, the other's insert does nothing, both read the row.
    await knex(TABLE).insert({ site_id: siteId }).onConflict('site_id').ignore();
    row = await select();
  }
  if (!row) throw new Error(`The store row of site ${siteId} could not be made`);
  return toStoreRow(siteId, row);
}

// On globalThis because Next bundles every route on its own (see lib/platform/site.ts).
const STORE_TTL_MS = 30_000;
const globalForStores = globalThis as unknown as { __webStudioStores?: TtlCache<StoreRow> };
const stores = (): TtlCache<StoreRow> => (globalForStores.__webStudioStores ??= new TtlCache<StoreRow>(STORE_TTL_MS));

/**
 * The site's store as the published site needs it (sessions W2 and W3):
 * selling, currency, branch id, category ids, fee. Kept 30 seconds per site.
 */
export async function storeOf(siteId: string): Promise<StoreRow> {
  const cached = stores().get(siteId);
  if (cached) return cached;
  const row = await storeRow(siteId);
  stores().set(siteId, row);
  return row;
}

type Outcome<T> = { ok: true; value: T } | { ok: false; error: string };

/** A service read whose failure is shown, not thrown: only the services' own "unavailable" errors are caught. */
async function settle<T>(read: Promise<T>): Promise<Outcome<T>> {
  try {
    return { ok: true, value: await read };
  } catch (error) {
    if (error instanceof OrgSetupUnavailableError || error instanceof ProductServicesUnavailableError) {
      return { ok: false, error: error.message };
    }
    throw error;
  }
}

async function chosenBranch(organizationId: string, branchId: string | null, active: Outcome<Branch[]>): Promise<StoreBranch | null> {
  if (!branchId) return null;
  if (!active.ok) return { id: branchId, name: null, available: null };
  const current = active.value.find((branch) => branch.id === branchId);
  if (current) return { id: branchId, name: current.name, available: true };
  // Not active any more: its name still resolves while the branch is archived.
  const known = await settle(findBranches(organizationId, [branchId]));
  return { id: branchId, name: known.ok ? (known.value[0]?.name ?? null) : null, available: false };
}

async function chosenCategories(organizationId: string, ids: string[], tree: Outcome<StoreCategoryNode[]>): Promise<StoreCategory[]> {
  if (!tree.ok) return ids.map((id) => ({ id, name: null, name_ar: null, item_count: null, available: null }));
  const live = indexTree(tree.value);
  return Promise.all(
    ids.map(async (id): Promise<StoreCategory> => {
      const node = live.get(id);
      if (node) return { id, name: node.name, name_ar: node.name_ar, item_count: node.item_count, available: true };
      // Not in the live tree: archived (its name still resolves) or gone.
      const known = await settle(getCategory(organizationId, id));
      const category = known.ok ? known.value : null;
      return { id, name: category?.name ?? null, name_ar: category?.name_ar ?? null, item_count: null, available: false };
    }),
  );
}

/** The store settings of a live site; the caller has checked it belongs to the session's organization. */
export async function readStoreSettings(site: Site): Promise<StoreSettings> {
  const row = await storeRow(site.id);
  const [branches, tree] = await Promise.all([
    settle(listBranches(site.organization_id)),
    settle(getCategoryTree(site.organization_id).then(rollUpTree)),
  ]);
  const [branch, categories] = await Promise.all([
    chosenBranch(site.organization_id, row.branch_id, branches),
    chosenCategories(site.organization_id, row.category_ids, tree),
  ]);
  return {
    selling: row.selling,
    currency: row.currency,
    branch,
    branches: branches.ok ? branches.value.map((b) => ({ id: b.id, name: b.name })) : null,
    branches_error: branches.ok ? null : branches.error,
    categories,
    category_tree: tree.ok ? tree.value : null,
    category_tree_error: tree.ok ? null : tree.error,
    delivery_fee: row.delivery_fee,
    payment_methods: [...PAYMENT_METHODS],
  };
}

async function checkBranch(organizationId: string, branchId: string): Promise<void> {
  let active: Branch[];
  try {
    active = await listBranches(organizationId);
  } catch (error) {
    if (error instanceof OrgSetupUnavailableError) {
      throw new StoreSettingsError('org_setup_unavailable', `The organization's branches could not be read, so the branch cannot be checked: ${error.message}`, { field: 'branch_id' });
    }
    throw error;
  }
  if (!active.some((branch) => branch.id === branchId)) {
    throw new StoreSettingsError('branch_unavailable', `${branchId} is not an active branch of the organization`, { field: 'branch_id', branch_id: branchId });
  }
}

async function checkCategories(organizationId: string, ids: string[]): Promise<void> {
  let live: Map<string, StoreCategoryNode>;
  try {
    live = indexTree(rollUpTree(await getCategoryTree(organizationId)));
  } catch (error) {
    if (error instanceof ProductServicesUnavailableError) {
      throw new StoreSettingsError('product_services_unavailable', `The organization's categories could not be read, so the categories cannot be checked: ${error.message}`, { field: 'category_ids' });
    }
    throw error;
  }
  const unknown = ids.filter((id) => !live.has(id));
  if (unknown.length) {
    throw new StoreSettingsError('categories_unavailable', `Not live categories of the organization's catalogue: ${unknown.join(', ')}`, { field: 'category_ids', category_ids: unknown });
  }
}

/** A Postgres check violation of the table's "selling needs a branch" rule (a concurrent change cleared the branch). */
function isBranchRequiredViolation(error: unknown): boolean {
  const value = error as { code?: string; constraint?: string } | null;
  return value?.code === '23514' && value.constraint === 'platform_site_store_branch_required';
}

/**
 * Apply a patch to a site's store and answer the settings afterwards. Throws
 * `StoreSettingsError` for a change that cannot be applied; nothing is written
 * then. Only the fields the patch changes are written, so two people changing
 * different fields at once both keep their change.
 */
export async function applyStoreSettings(site: Site, patch: StorePatch, user: { id: string }): Promise<StoreSettings> {
  if (site.is_template) {
    throw new StoreSettingsError('template', 'A template never sells: its store settings cannot be changed');
  }
  const plan = planStorePatch(await storeRow(site.id), patch);
  if ('error' in plan) throw new StoreSettingsError(plan.error.code, plan.error.message, { field: plan.error.field });

  await Promise.all([
    plan.checkBranch ? checkBranch(site.organization_id, plan.checkBranch) : Promise.resolve(),
    plan.checkCategories.length ? checkCategories(site.organization_id, plan.checkCategories) : Promise.resolve(),
  ]);

  if (Object.keys(plan.changes).length) {
    const knex = await getKnexClient();
    try {
      await knex(TABLE)
        .where({ site_id: site.id })
        .update({ ...plan.changes, updated_at: knex.fn.now(), updated_by: user.id });
    } catch (error) {
      if (isBranchRequiredViolation(error)) {
        throw new StoreSettingsError('branch_required', 'A site that sells needs a branch: the branch was cleared by another change meanwhile', { field: 'branch_id' });
      }
      throw error;
    } finally {
      stores().forget(site.id);
    }
  }
  return readStoreSettings(site);
}
