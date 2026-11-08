/**
 * What the checkout decides about a cart's lines, and what its confirmation
 * shows of the Sales order (part 2, session W3; PRD V1.1 "Cart and checkout").
 * Pure: lib/platform/checkout.ts reads and writes.
 *
 * A line names a plain item or a variant by its own item id, never a product
 * with variants (decision 14b). Before anything is created the lines are
 * checked against the site's catalogue, the one its pages show
 * (lib/platform/catalogue-rules.ts): a line it cannot sell is refused with 422
 * `item_unavailable`, naming each such line so the page can offer Remove. The
 * catalogue is up to 60 seconds old; Sales checks every item again when it
 * creates the order, and its refusal names the item ids (SL2, OPEN_QUESTIONS
 * 29), which map to the same answer.
 *
 * Reasons: `inactive`, `no_price`, `no_rate` (a variant the picker shows as
 * unavailable, or Sales's own finding), `parent` (a product with variants: the
 * variant is what is bought), `not_on_sale` (anything else the site does not
 * sell now: unknown, outside its categories, its channel off, or a plain item
 * that lost its price, which the catalogue no longer lists). The page shows
 * every reason as "no longer available" (decision 16g).
 *
 * Kept free of Next imports so it runs under `node --test`.
 */

import type { Catalogue, StoreProduct, StoreVariant } from '@/lib/platform/catalogue-rules';
import type { CheckoutLine, CheckoutLocale } from '@/lib/platform/checkout-input';
import type { SalesOrder } from '@/lib/platform/sales';

export type LineRefusalReason = 'inactive' | 'no_price' | 'no_rate' | 'parent' | 'not_on_sale';

export interface UnavailableLine {
  item_id: string;
  /** The product's name in the page's language, with the variant's options; null when the catalogue no longer knows the item (the page names it from the cart). */
  name: string | null;
  reason: LineRefusalReason;
}

const nameIn = (product: StoreProduct, locale: CheckoutLocale) => (locale === 'ar' && product.name_ar ? product.name_ar : product.name);

/**
 * A line's name as the design quotes it: "Linen shirt — Size: Small, Colour:
 * White", "قميص كتان — المقاس: صغير، اللون: أبيض". An Arabic label falls back
 * to the English one when Product & Services has none.
 */
export function lineName(product: StoreProduct, variant: StoreVariant | null, locale: CheckoutLocale): string {
  const base = nameIn(product, locale);
  if (!variant || variant.axes.length === 0) return base;
  const options = variant.axes.map((axis) =>
    locale === 'ar' ? `${axis.name_ar ?? axis.name}: ${axis.option_ar ?? axis.option}` : `${axis.name}: ${axis.option}`,
  );
  return `${base} — ${options.join(locale === 'ar' ? '، ' : ', ')}`;
}

/** The name of an item id in the catalogue (a product or a variant), or null. */
export function itemName(catalogue: Catalogue, itemId: string, locale: CheckoutLocale): string | null {
  const product = catalogue.byId.get(itemId);
  if (product) return lineName(product, null, locale);
  const found = catalogue.variantsById.get(itemId);
  return found ? lineName(found.product, found.variant, locale) : null;
}

/** Why the site cannot sell this line now; null when it can. */
export function lineRefusal(catalogue: Catalogue, itemId: string): LineRefusalReason | null {
  const product = catalogue.byId.get(itemId);
  if (product) return product.variants.length > 0 ? 'parent' : null;
  const found = catalogue.variantsById.get(itemId);
  if (!found) return 'not_on_sale';
  return found.variant.available ? null : found.variant.unavailable_reason ?? 'not_on_sale';
}

/** The lines the site cannot sell now, once per item id, in the cart's order. Empty when every line can be bought. */
export function unavailableLines(catalogue: Catalogue, lines: CheckoutLine[], locale: CheckoutLocale): UnavailableLine[] {
  const refused: UnavailableLine[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    if (seen.has(line.item_id)) continue;
    seen.add(line.item_id);
    const reason = lineRefusal(catalogue, line.item_id);
    if (reason) refused.push({ item_id: line.item_id, name: itemName(catalogue, line.item_id, locale), reason });
  }
  return refused;
}

/** Sales's 422 codes that are about items (SL1, SL2), and the reason the page is given for each. */
export const SALES_ITEM_CODES: Readonly<Record<string, LineRefusalReason>> = {
  item_not_found: 'not_on_sale',
  item_inactive: 'inactive',
  item_is_parent: 'parent',
  item_no_price: 'no_price',
  item_currency_mismatch: 'no_price',
  no_rate_for_date: 'no_rate',
};

export type SalesRefusalAnswer =
  | { kind: 'item_unavailable'; items: UnavailableLine[] }
  /** Nothing the buyer can fix: the store answers 503 and the reason is logged. */
  | { kind: 'service_unavailable'; reason: string };

/**
 * What the page is told when Sales refuses the order with a 422. An item code
 * with the ids it names (only the cart's own) is `item_unavailable`; an item
 * code naming none of the cart's lines, `no_rate_for_date` about the order's
 * own rate (no items), the customer, the branch or a code W3 does not know is
 * the store's problem, not the buyer's.
 */
export function salesRefusalAnswer(
  refusal: { code: string; items: string[] },
  lines: CheckoutLine[],
  catalogue: Catalogue,
  locale: CheckoutLocale,
): SalesRefusalAnswer {
  const reason = SALES_ITEM_CODES[refusal.code];
  if (!reason) return { kind: 'service_unavailable', reason: `Sales refused the order: ${refusal.code}` };
  const inCart = new Set(lines.map((line) => line.item_id));
  const ids = Array.from(new Set(refusal.items.map((id) => id.toLowerCase()))).filter((id) => inCart.has(id));
  if (ids.length === 0) {
    return { kind: 'service_unavailable', reason: `Sales refused the order with ${refusal.code}, naming none of its lines` };
  }
  return { kind: 'item_unavailable', items: ids.map((id) => ({ item_id: id, name: itemName(catalogue, id, locale), reason })) };
}

/** A confirmed order's line, in the page's two languages. */
export interface ConfirmationLine {
  item_id: string;
  sku: string;
  name: string;
  name_ar: string | null;
  axes: Array<{ name: string; name_ar: string | null; option: string; option_ar: string | null }>;
  unit: { code: string; name: string };
  quantity: string;
  unit_price: string;
  line_total: string;
}

export interface Confirmation {
  checkout_id: string;
  code: string;
  currency: SalesOrder['currency'];
  lines: ConfirmationLine[];
  subtotal: string;
  delivery_fee: string;
  total: string;
  /** Sales's: cash on delivery for every storefront order. */
  payment_method: SalesOrder['paymentMethod'];
  /** The number the buyer typed, which the courier calls (OPEN_QUESTIONS 26). */
  phone: string | null;
}

/** What the confirmation page shows of a Sales order. */
export function confirmationOf(checkoutId: string, order: SalesOrder): Confirmation {
  return {
    checkout_id: checkoutId,
    code: order.code,
    currency: order.currency,
    lines: order.lines.map((line) => ({
      item_id: line.itemId,
      sku: line.sku,
      name: line.name.en,
      name_ar: line.name.ar,
      axes: line.axes.map((axis) => ({ name: axis.specification.en, name_ar: axis.specification.ar, option: axis.option.en, option_ar: axis.option.ar })),
      unit: line.unit,
      quantity: line.quantity,
      unit_price: line.unitPrice,
      line_total: line.lineTotal,
    })),
    subtotal: order.subtotal,
    delivery_fee: order.deliveryFee,
    total: order.total,
    payment_method: order.paymentMethod,
    phone: order.deliveryAddress?.phone ?? null,
  };
}
