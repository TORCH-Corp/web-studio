/**
 * The order summary the cart and the checkout show (part 2, session W6; PRD
 * V1.1 "Cart and checkout"): each line's total, the subtotal, the delivery fee
 * and the total, in the site's currency.
 *
 * The lines come from the cart (their snapshots, refreshed from the catalogue
 * when the page opened); the currency and the delivery fee come from the
 * store's settings (`GET /ycode/api/store/settings`). The amounts are exact
 * decimals (lib/platform/store-money.ts), the same arithmetic Sales does, so
 * the total shown is the total on the order unless a price changed meanwhile.
 *
 * Kept free of Next and React imports so it runs under `node --test`.
 */

import type { CartLine } from '@/lib/platform/store-elements/cart-store';
import { addAmounts, multiplyAmount, type StoreCurrency } from '@/lib/platform/store-money';

/** What the store's settings say that the summary needs. */
export interface StoreTerms {
  currency: StoreCurrency;
  /** A decimal string; "0.00" for free delivery. */
  delivery_fee: string;
}

export interface Money {
  amount: string;
  currency: StoreCurrency;
}

export interface SummaryLine {
  line: CartLine;
  /** The line's price times its quantity. */
  total: Money;
}

export type OrderSummary =
  | { kind: 'empty' }
  /** A line is priced in another currency than the store's now (it changed its currency since the line was added): the lines are read again before an amount is shown. */
  | { kind: 'stale' }
  | { kind: 'ready'; lines: SummaryLine[]; count: number; subtotal: Money; fee: Money; total: Money };

export function summarise(lines: readonly CartLine[], terms: StoreTerms): OrderSummary {
  if (lines.length === 0) return { kind: 'empty' };
  if (lines.some((line) => line.snapshot.price.currency !== terms.currency)) return { kind: 'stale' };
  const rows = lines.map((line) => ({ line, total: { amount: multiplyAmount(line.snapshot.price.amount, line.quantity), currency: terms.currency } }));
  const subtotal = rows.reduce((sum, row) => addAmounts(sum, row.total.amount), '0');
  return {
    kind: 'ready',
    lines: rows,
    count: lines.reduce((sum, line) => sum + line.quantity, 0),
    subtotal: { amount: subtotal, currency: terms.currency },
    fee: { amount: terms.delivery_fee, currency: terms.currency },
    total: { amount: addAmounts(subtotal, terms.delivery_fee), currency: terms.currency },
  };
}
