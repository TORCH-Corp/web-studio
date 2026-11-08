/**
 * The body of `PATCH /ycode/api/platform/sites/{id}/store` and the rules a
 * patch must meet (part 2, session W1; PRD V1.1 "Store settings").
 *
 * Every field is optional: a PATCH changes what it names. Only what changes is
 * checked against Organization Setup and Product & Services (owner, 8 Nov
 * 2026): the screen sends the whole form back, and a branch or a category that
 * has become unavailable since it was chosen stays stored until the owner
 * changes it. Kept free of Next imports so it runs under `node --test`.
 */

import { z } from 'zod';

export const STORE_CURRENCIES = ['IQD', 'USD'] as const;
export type StoreCurrency = (typeof STORE_CURRENCIES)[number];

/** The only payment method of part 2 (PRD V1.1 "Store settings"). */
export const PAYMENT_METHODS = ['cash_on_delivery'] as const;

/** A site's store as platform_site_store keeps it. `delivery_fee` is the decimal with two places, as a string. */
export interface StoreRow {
  selling: boolean;
  currency: StoreCurrency;
  branch_id: string | null;
  category_ids: string[];
  delivery_fee: string;
}

/** What a site has before anyone changes its store. */
export const DEFAULT_STORE: StoreRow = { selling: false, currency: 'IQD', branch_id: null, category_ids: [], delivery_fee: '0.00' };

/** numeric(14,2): twelve digits before the point. */
const FEE_PATTERN = /^\d{1,12}(\.\d{1,2})?$/;
/** More would be a list nobody picks by hand; the screen's picker shows the whole tree. */
export const MAX_CATEGORIES = 200;

/**
 * A fee as the screen sends it, a JSON number or a decimal string, as the
 * canonical string with two places: 2500 → "2500.00", "12.5" → "12.50".
 * Null for anything that is not zero or more with at most two decimals.
 */
export function normaliseFee(value: number | string): string | null {
  const text = typeof value === 'number' ? (Number.isFinite(value) ? String(value) : '') : value.trim();
  if (!FEE_PATTERN.test(text)) return null;
  const [whole, fraction = ''] = text.split('.');
  return `${BigInt(whole).toString()}.${fraction.padEnd(2, '0')}`;
}

const fee = z.union([z.number(), z.string()]).transform((value, context) => {
  const normalised = normaliseFee(value);
  if (normalised === null) {
    context.addIssue({ code: 'custom', message: 'delivery_fee must be zero or more, with at most two decimals and twelve digits before the point' });
    return z.NEVER;
  }
  return normalised;
});

export const storePatchSchema = z
  .object({
    selling: z.boolean().optional(),
    currency: z.enum(STORE_CURRENCIES).optional(),
    /** One of the organization's active branches; null clears it (not while selling). */
    branch_id: z
      .uuid()
      .transform((id) => id.toLowerCase())
      .nullable()
      .optional(),
    /** The complete set of categories afterwards; empty sells every eligible item. */
    category_ids: z
      .array(z.uuid().transform((id) => id.toLowerCase()))
      .max(MAX_CATEGORIES, `at most ${MAX_CATEGORIES} categories`)
      .transform((ids) => Array.from(new Set(ids)))
      .optional(),
    delivery_fee: fee.optional(),
  })
  .strict();

export type StorePatch = z.infer<typeof storePatchSchema>;

/** Parse a request body; the messages are ready to return in a 400. */
export function parseStorePatch(body: unknown): { patch: StorePatch; errors: null } | { patch: null; errors: string[] } {
  const result = storePatchSchema.safeParse(body);
  if (result.success) return { patch: result.data, errors: null };
  const errors = result.error.issues.map((issue) => (issue.path.length ? `${issue.path.join('.')}: ${issue.message}` : issue.message));
  return { patch: null, errors };
}

/** A patch the rules refuse before any service is asked. */
export interface StoreRuleError {
  code: 'branch_required' | 'fee_required';
  field: 'branch_id' | 'delivery_fee';
  message: string;
}

/** What a patch leaves, and what of it must be checked with the services first. */
export interface StorePlan {
  next: StoreRow;
  /** The fields to write: only those the patch changes. */
  changes: Partial<StoreRow>;
  /** A branch that must be one of the organization's active branches: a new one, or the stored one when selling is switched on. */
  checkBranch: string | null;
  /** Categories new to the site, which must be live categories of the organization. */
  checkCategories: string[];
}

/**
 * Apply a patch to the stored store, without any service: the rules that need
 * none, and what must still be checked.
 *
 * - A site that sells has a branch: selling on with no branch afterwards is
 *   `branch_required`, whether the patch switches selling on or clears the branch.
 * - A currency change names the fee in the same patch (owner, 8 Nov 2026): the
 *   amount is never reread in another currency unseen, `fee_required`.
 * - A branch is checked when it is new, or when selling is switched on (the
 *   stored one may have been archived since). A category is checked when it is
 *   new to the site. The rest was checked when it was stored.
 */
export function planStorePatch(current: StoreRow, patch: StorePatch): StorePlan | { error: StoreRuleError } {
  const changes: Partial<StoreRow> = {};
  if (patch.selling !== undefined && patch.selling !== current.selling) changes.selling = patch.selling;
  if (patch.currency !== undefined && patch.currency !== current.currency) changes.currency = patch.currency;
  if (patch.branch_id !== undefined && patch.branch_id !== current.branch_id) changes.branch_id = patch.branch_id;
  if (patch.delivery_fee !== undefined && patch.delivery_fee !== current.delivery_fee) changes.delivery_fee = patch.delivery_fee;
  if (patch.category_ids !== undefined) {
    const same = patch.category_ids.length === current.category_ids.length && patch.category_ids.every((id) => current.category_ids.includes(id));
    if (!same) changes.category_ids = patch.category_ids;
  }
  const next: StoreRow = { ...current, ...changes };

  if (changes.currency !== undefined && patch.delivery_fee === undefined) {
    return { error: { code: 'fee_required', field: 'delivery_fee', message: `The currency changes to ${changes.currency}: send the delivery fee in ${changes.currency} with it` } };
  }
  if (next.selling && !next.branch_id) {
    return { error: { code: 'branch_required', field: 'branch_id', message: 'A site that sells needs a branch: every order from the site is created in it' } };
  }

  const switchesOn = changes.selling === true;
  const checkBranch = next.branch_id && (changes.branch_id !== undefined || switchesOn) ? next.branch_id : null;
  const checkCategories = next.category_ids.filter((id) => !current.category_ids.includes(id));
  return { next, changes, checkBranch, checkCategories };
}
