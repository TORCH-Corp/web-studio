/**
 * Money on the storefront (part 2, session W2): exact decimals, and the
 * conversion between IQD and USD at the day's rate.
 *
 * The rules are Sales's, so the price a buyer sees is the price on the Sales
 * order (sales-service `src/domain/pricing/money.ts`, decision P22): amounts
 * are decimal strings computed as scaled integers, never floats; an amount that
 * is computed is rounded half up to its currency's display precision (USD two
 * decimals, IQD none); a base price from Product & Services keeps the digits it
 * has (up to four).
 *
 * One rate converts both ways (owner, 8 Nov 2026, W2 grill-me): Organization
 * Setup's USD→IQD rate of the day, the one Sales keeps on a USD order. A USD
 * price times the rate is IQD; an IQD price divided by it is USD. The as-of
 * route has no IQD→USD rate on production and never inverts one, so asking the
 * exact pair would hide every IQD item on a USD site. Session SL2 charges by
 * this same rule.
 *
 * Kept free of Next imports so it runs under `node --test`.
 */

export type StoreCurrency = 'IQD' | 'USD';

/** Decimal places an amount is computed and shown at (Sales P22). */
export const DISPLAY_SCALE: Record<StoreCurrency, number> = { USD: 2, IQD: 0 };

/** The time zone of "the day" a rate is asked for: Sales's (`order-rate.ts`). Baghdad keeps UTC+3 all year. */
export const RATE_TIME_ZONE = 'Asia/Baghdad';

const DAY = new Intl.DateTimeFormat('en-CA', { timeZone: RATE_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });

/** The day in Baghdad at `now`, as YYYY-MM-DD. */
export function rateDay(now: Date): string {
  return DAY.format(now);
}

/** A non-negative decimal as an integer of units at `scale` decimal places. */
interface Scaled {
  units: bigint;
  scale: number;
}

const DECIMAL = /^\d+(\.\d+)?$/;
const TEN = BigInt(10);
const pow10 = (n: number): bigint => TEN ** BigInt(n);

function parse(text: string): Scaled {
  if (!DECIMAL.test(text)) throw new Error(`Not a non-negative decimal: ${text}`);
  const [whole, fraction = ''] = text.split('.');
  return { units: BigInt(whole + fraction), scale: fraction.length };
}

/** Units at a larger scale, exactly. */
function widen(value: Scaled, scale: number): bigint {
  return value.units * pow10(scale - value.scale);
}

/** numerator / denominator rounded half up (both positive or the numerator zero). */
function divideHalfUp(numerator: bigint, denominator: bigint): bigint {
  return (numerator * BigInt(2) + denominator) / (denominator * BigInt(2));
}

/** `units` at `scale` as text with exactly `scale` decimals. */
function format(units: bigint, scale: number): string {
  if (scale === 0) return units.toString();
  const digits = units.toString().padStart(scale + 1, '0');
  return `${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
}

/**
 * A number from a JSON body as a decimal string with at most `maxScale`
 * decimals, trailing zeros dropped: 25000 → "25000", 12.5 → "12.5". Product &
 * Services sends base prices as numbers (Decimal(18,4)); Organization Setup
 * sends rates as numbers (Decimal(20,8) at Sales). Null for anything that is
 * not a finite number zero or above.
 */
export function decimalFromNumber(value: unknown, maxScale: number): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  const fixed = value.toFixed(maxScale);
  return maxScale === 0 ? fixed : fixed.replace(/\.?0+$/, '');
}

/** Whether a decimal string is above zero. */
export function isPositive(amount: string): boolean {
  return parse(amount).units > BigInt(0);
}

/**
 * An amount as a price is shown: at least the currency's display decimals, and
 * every further digit it has ("12.5" USD → "12.50", "12.3456" USD stays,
 * "25000" IQD stays).
 */
export function displayAmount(amount: string, currency: StoreCurrency): string {
  const value = parse(amount);
  const scale = Math.max(value.scale, DISPLAY_SCALE[currency]);
  return format(widen(value, scale), scale);
}

/**
 * An amount in `from` converted into `to` at `usdIqdRate` (IQD per USD),
 * rounded half up to `to`'s display precision. The same currency is the
 * amount itself, at least at the display precision.
 */
export function convert(amount: string, from: StoreCurrency, to: StoreCurrency, usdIqdRate: string): string {
  if (from === to) return displayAmount(amount, to);
  const value = parse(amount);
  const rate = parse(usdIqdRate);
  if (rate.units === BigInt(0)) throw new Error('A rate of zero converts nothing');
  const target = DISPLAY_SCALE[to];
  if (from === 'USD') {
    // amount × rate, at the scale of both, brought down to the target's.
    const product = value.units * rate.units;
    return format(divideHalfUp(product, pow10(value.scale + rate.scale - target)), target);
  }
  // amount ÷ rate: (value.units / 10^vs) / (rate.units / 10^rs), times 10^target.
  return format(divideHalfUp(value.units * pow10(rate.scale + target), rate.units * pow10(value.scale)), target);
}

/** Negative when a < b, zero when equal, positive when a > b. */
export function compareAmounts(a: string, b: string): number {
  const x = parse(a);
  const y = parse(b);
  const scale = Math.max(x.scale, y.scale);
  const diff = widen(x, scale) - widen(y, scale);
  return diff < BigInt(0) ? -1 : diff > BigInt(0) ? 1 : 0;
}

/**
 * A price times a whole quantity (a cart line's total), exact, at the price's
 * own number of decimals. The quantity is a whole number above zero.
 */
export function multiplyAmount(amount: string, quantity: number): string {
  if (!Number.isInteger(quantity) || quantity < 0) throw new Error(`The quantity must be a whole number: ${quantity}`);
  const value = parse(amount);
  return format(value.units * BigInt(quantity), value.scale);
}

/** Two amounts added, exact, at the larger of their decimals. */
export function addAmounts(a: string, b: string): string {
  const x = parse(a);
  const y = parse(b);
  const scale = Math.max(x.scale, y.scale);
  return format(widen(x, scale) + widen(y, scale), scale);
}
