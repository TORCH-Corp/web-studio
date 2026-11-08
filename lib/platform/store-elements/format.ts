/**
 * A price as the store pages show it (handoff: "25,000 IQD", "25,000 د.ع"):
 * the integer part grouped by thousands with a comma, the decimals as the
 * service gave them (never a float, so no digit changes), Western digits, then
 * the currency in the page's language.
 *
 * Kept free of Next and React imports so it runs under `node --test`.
 */

import { STORE_STRINGS, type StoreLang } from '@/lib/platform/store-elements/strings';

export type PriceLike = { amount: string; currency: 'IQD' | 'USD' };

const AMOUNT = /^(\d+)(?:\.(\d+))?$/;

/** `25000` → `25,000`; `12.50` → `12.50`; an amount that is not a non-negative decimal is returned as it came. */
export function groupAmount(amount: string): string {
  const match = AMOUNT.exec(amount);
  if (!match) return amount;
  const [, whole, fraction] = match;
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return fraction === undefined ? grouped : `${grouped}.${fraction}`;
}

export function formatPrice(price: PriceLike, lang: StoreLang): string {
  return `${groupAmount(price.amount)} ${STORE_STRINGS[lang].currency[price.currency]}`;
}
