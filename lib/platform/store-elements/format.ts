/**
 * A price as the store pages show it (handoff: "25,000 IQD", "25,000 د.ع"):
 * the integer part grouped by thousands with a comma, the decimals as the
 * service gave them (never a float, so no digit changes), Western digits, then
 * the currency in the page's language.
 *
 * Kept free of Next and React imports so it runs under `node --test`.
 */

import { DISPLAY_SCALE } from '@/lib/platform/store-money';
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

/**
 * An amount from Sales or the store's settings as the buyer reads it (session W6). Sales sends decimal strings at
 * the precision it stores ("5000.00", "25000.0000"); the buyer reads "5,000 IQD". The decimals beyond the
 * currency's display precision are dropped when they are only zeros (IQD none, USD two), so "12.50" USD stays and
 * "5000.00" IQD becomes "5,000"; a digit that is not a zero is never dropped.
 */
export function moneyText(price: PriceLike, lang: StoreLang): string {
  const match = AMOUNT.exec(price.amount);
  if (!match) return formatPrice(price, lang);
  const [, whole, fraction = ''] = match;
  const kept = fraction.replace(/0+$/, '').padEnd(DISPLAY_SCALE[price.currency], '0');
  return formatPrice({ amount: kept ? `${whole}.${kept}` : whole, currency: price.currency }, lang);
}

/** A quantity from Sales ("2", "2.0000", "1.5") without the zeros it keeps for decimals. */
export function quantityText(quantity: string): string {
  const match = AMOUNT.exec(quantity);
  if (!match) return quantity;
  const [, whole, fraction = ''] = match;
  const kept = fraction.replace(/0+$/, '');
  return kept ? `${whole}.${kept}` : whole;
}

interface AxisLike {
  name: string;
  name_ar: string | null;
  option: string;
  option_ar: string | null;
}

/** A variant's options as a line shows them: "Colour: Black · Size: M" / "اللون: أسود · المقاس: M"; empty for a plain item. */
export function optionsText(axes: readonly AxisLike[], lang: StoreLang): string {
  return axes.map((axis) => `${lang === 'ar' && axis.name_ar ? axis.name_ar : axis.name}: ${lang === 'ar' && axis.option_ar ? axis.option_ar : axis.option}`).join(' · ');
}

/** The unit as a line shows it: its symbol, else its name; null for an item with no unit. */
export function unitText(unit: { name: string; symbol?: string } | null): string | null {
  return unit ? unit.symbol || unit.name || null : null;
}
