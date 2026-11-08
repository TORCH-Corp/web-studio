/**
 * Reading the cart's lines again from the catalogue (part 2, session W6; PRD
 * V1.1 "Cart and checkout": prices shown from the snapshot and refreshed from
 * the catalogue on load).
 *
 * A line keeps a snapshot of what the buyer saw when they added it (name,
 * options, price, picture, unit). The snapshot is display only: the order is
 * priced again by Sales. When the cart or the checkout opens, each product in
 * the cart is read from the store API once, and each line is held against the
 * product it names:
 *
 *   - the line is still on sale: its snapshot becomes what the catalogue says
 *     now; when the price is not the one shown, the line says so (`changed`);
 *   - the product, or the variant, is gone, has no price or cannot be bought:
 *     the line is `unavailable`, and the buyer removes it (the checkout would
 *     refuse it anyway, naming it);
 *   - the catalogue could not be read: the lines stay as they are and the
 *     reader is told (`failed`), so an old price is not passed off as a fresh one.
 *
 * `refreshLine` is the rule, pure; `refreshCart` is the walk over the cart.
 * Kept free of Next and React imports so it runs under `node --test`.
 */

import type { StoreProduct } from '@/lib/platform/catalogue-rules';
import { snapshotFor } from '@/lib/platform/store-elements/add-to-cart';
import type { CartLine, CartLineSnapshot, CartStore } from '@/lib/platform/store-elements/cart-store';
import { compareAmounts } from '@/lib/platform/store-money';

export type PriceShown = CartLineSnapshot['price'];

export type LineRefresh =
  /** On sale and showing what the catalogue says (nothing to change). */
  | { kind: 'same' }
  /** On sale; `snapshot` is what to show now, and `was` the price it replaces when that is not the same price. */
  | { kind: 'updated'; snapshot: CartLineSnapshot; was: PriceShown | null }
  /** The catalogue no longer sells this line. */
  | { kind: 'unavailable' };

const samePrice = (a: PriceShown, b: PriceShown) => a.currency === b.currency && compareAmounts(a.amount, b.amount) === 0;

/** A line held against its product as the catalogue has it now; `product` is null when the catalogue no longer has it. */
export function refreshLine(line: CartLine, product: StoreProduct | null): LineRefresh {
  if (!product) return { kind: 'unavailable' };
  let variant = null;
  if (line.item_id !== product.id) {
    variant = product.variants.find((candidate) => candidate.id === line.item_id) ?? null;
    if (!variant || !variant.available || !variant.price) return { kind: 'unavailable' };
  } else if (product.variants.length > 0) {
    // A parent is never sold (decision 14b): a line that names one is from before the product got variants.
    return { kind: 'unavailable' };
  }
  const snapshot = snapshotFor(product, variant);
  if (JSON.stringify(snapshot) === JSON.stringify(line.snapshot)) return { kind: 'same' };
  return { kind: 'updated', snapshot, was: samePrice(snapshot.price, line.snapshot.price) ? null : line.snapshot.price };
}

/** What the walk found, by item id. */
export interface CartRefresh {
  /** The lines whose price is not the one the buyer saw: the price they saw. */
  changed: ReadonlyMap<string, PriceShown>;
  unavailable: ReadonlySet<string>;
  /** Some product could not be read: its lines were left as they are. */
  failed: boolean;
}

export const NOTHING_REFRESHED: CartRefresh = { changed: new Map(), unavailable: new Set(), failed: false };

/** What reading one product gave: the product, null for one the catalogue no longer has, or the failure. */
export type ProductRead = { kind: 'found'; product: StoreProduct } | { kind: 'gone' } | { kind: 'failed' };

/** Reads each product in the cart once, holds each line against it and updates the cart's snapshots. */
export async function refreshCart(cart: Pick<CartStore, 'lines' | 'refresh'>, read: (productId: string) => Promise<ProductRead>): Promise<CartRefresh> {
  const productIds = [...new Set(cart.lines().map((line) => line.product_id))];
  const reads = new Map<string, ProductRead>();
  await Promise.all(productIds.map(async (id) => void reads.set(id, await read(id))));

  const changed = new Map<string, PriceShown>();
  const unavailable = new Set<string>();
  let failed = false;
  // The cart may have changed while the products were read: hold the lines it has now.
  for (const line of cart.lines()) {
    const result = reads.get(line.product_id);
    if (!result) continue;
    if (result.kind === 'failed') {
      failed = true;
      continue;
    }
    const refreshed = refreshLine(line, result.kind === 'found' ? result.product : null);
    if (refreshed.kind === 'unavailable') unavailable.add(line.item_id);
    else if (refreshed.kind === 'updated') {
      cart.refresh(line.item_id, refreshed.snapshot);
      if (refreshed.was) changed.set(line.item_id, refreshed.was);
    }
  }
  return { changed, unavailable, failed };
}
