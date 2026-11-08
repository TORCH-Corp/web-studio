/**
 * The buyer's cart (part 2: the seam in session W4, the cart itself in W5; PRD
 * V1.1 "Cart and checkout").
 *
 * The cart lives in the buyer's browser, per site, and survives a reload: a
 * client module over localStorage under `ws-cart:{siteId}`. No account, no
 * server copy. A line names the item to sell (the variant's own item id when
 * the product has variants) and carries a snapshot of what the cart shows for
 * it. The snapshot is for display only: prices are read again at checkout
 * (W3's route) and the cart element refreshes them on load (W6).
 *
 * Three layers:
 * - `createCartStore` is the cart over any storage (pure, runs under
 *   `node --test` with an in-memory one);
 * - `connectBrowserCart` makes the one for the page from the browser's
 *   localStorage and follows the other tabs;
 * - `getCartStore` / `connectCartStore` / `subscribeToCart` are the seam the
 *   elements are written against (the cart indicator, the cards, the product
 *   page and W6's cart and checkout): they read whatever is connected, and
 *   follow a cart connected after they started.
 *
 * The connected store is kept on `globalThis`, not in a module variable: Next
 * bundles client code into chunks, and the module that connects the cart and
 * the chunk of an element that reads it need not be the same copy of this file
 * (the same reason lib/knex-client.ts and lib/platform/site.ts keep theirs
 * there). It also lets a test put a cart in place before the page starts.
 */

import { addAmounts, multiplyAmount } from '@/lib/platform/store-money';

/** A checkout takes 1 to 50 lines (lib/platform/checkout-input.ts), so the cart holds no more. */
export const MAX_CART_LINES = 50;
/** The most of one item a line holds: wholesale buyers order in hundreds, and the cart badge reads "99+" above 99. */
export const MAX_LINE_QUANTITY = 999;

const CART_VERSION = 1;
const KEY_PREFIX = 'ws-cart:';
const AMOUNT = /^\d+(?:\.\d+)?$/;

export const cartStorageKey = (siteId: string): string => `${KEY_PREFIX}${siteId}`;

/** One axis of the variant a line sells, as the cart shows it: "Colour: Black" / "اللون: أسود". */
export interface CartAxisLabel {
  name: string;
  name_ar: string | null;
  option: string;
  option_ar: string | null;
}

export interface CartLineSnapshot {
  name: string;
  name_ar: string | null;
  /** Empty for a plain item. */
  axes: CartAxisLabel[];
  price: { amount: string; currency: 'IQD' | 'USD' };
  image: string | null;
  unit: { name: string; symbol: string } | null;
}

export interface CartLineInput {
  /** The item to sell: the variant's own item id when the product has variants, else the product's. */
  item_id: string;
  /** The product the line belongs to (the page of its name, the catalogue read that refreshes it): the item itself when it has no variants. */
  product_id: string;
  quantity: number;
  /** What the cart shows for the line; display only, prices are read again at checkout (PRD V1.1). */
  snapshot: CartLineSnapshot;
}

export type CartLine = CartLineInput;

export interface CartTotals {
  /** The pieces in the cart: the quantity of all its lines (what the cart indicator shows). */
  count: number;
  lines: number;
  /** The lines' prices times their quantities; null for an empty cart, or one holding two currencies. */
  subtotal: { amount: string; currency: 'IQD' | 'USD' } | null;
  /** Two currencies in one cart: the site changed its currency since a line was added. The lines are refreshed from the catalogue (W6) before they are added. */
  mixedCurrency: boolean;
}

export interface CartStore {
  /** The number the cart indicator shows: the quantity of all the cart's lines. */
  count(): number;
  /** Calls `listener` whenever the cart changes; returns the way to stop. */
  subscribe(listener: () => void): () => void;
  /** The lines in the order they were added. The same array until the cart changes. */
  lines(): readonly CartLine[];
  /** Adds the quantity to the item's line, or starts the line; a new line in a full cart throws CartFullError. */
  add(line: CartLineInput): void;
  /** Sets a line's quantity, pulled into 1 to MAX_LINE_QUANTITY. Removing a line is `remove`. */
  setQuantity(itemId: string, quantity: number): void;
  remove(itemId: string): void;
  clear(): void;
  totals(): CartTotals;
}

export class CartStoreNotConnectedError extends Error {
  constructor() {
    super('The cart is not connected: nothing called connectCartStore() (lib/platform/store-elements/cart-store.ts)');
    this.name = 'CartStoreNotConnectedError';
  }
}

export class CartFullError extends Error {
  constructor() {
    super(`The cart holds ${MAX_CART_LINES} different items at most`);
    this.name = 'CartFullError';
  }
}

/** What stands in until a cart is connected: empty, and every change refuses rather than being dropped. */
export const unconnectedCartStore: CartStore = {
  count: () => 0,
  subscribe: () => () => {},
  lines: () => [],
  add: () => {
    throw new CartStoreNotConnectedError();
  },
  setQuantity: () => {
    throw new CartStoreNotConnectedError();
  },
  remove: () => {
    throw new CartStoreNotConnectedError();
  },
  clear: () => {
    throw new CartStoreNotConnectedError();
  },
  totals: () => ({ count: 0, lines: 0, subtotal: null, mixedCurrency: false }),
};

// ---------------------------------------------------------------------------
// The cart over a storage
// ---------------------------------------------------------------------------

/** The part of the Web Storage API the cart uses. */
export interface CartStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface CartStoreOptions {
  siteId: string;
  storage: CartStorage;
  /** A storage that cannot be read or written (private mode, no room): called once, then the cart goes on in memory for the visit. */
  onStorageError?: (error: unknown) => void;
}

export interface CartStoreWithReload extends CartStore {
  /** Reads the storage again (another tab changed the cart) and tells the subscribers if the cart is not what it was. */
  reload(): void;
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isText = (value: unknown): value is string => typeof value === 'string';
const isTextOrNull = (value: unknown): value is string | null => value === null || typeof value === 'string';

function axisOf(value: unknown): CartAxisLabel | null {
  if (!isObject(value) || !isText(value.name) || !isText(value.option) || !isTextOrNull(value.name_ar ?? null) || !isTextOrNull(value.option_ar ?? null)) return null;
  return { name: value.name, name_ar: (value.name_ar as string | null | undefined) ?? null, option: value.option, option_ar: (value.option_ar as string | null | undefined) ?? null };
}

/** A line as storage holds it, or null when it is not one a cart could have written. */
function lineOf(value: unknown): CartLine | null {
  if (!isObject(value) || !isText(value.item_id) || value.item_id === '' || !isText(value.product_id)) return null;
  const { quantity, snapshot } = value;
  if (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity < 1 || quantity > MAX_LINE_QUANTITY) return null;
  if (!isObject(snapshot) || !isText(snapshot.name) || !isTextOrNull(snapshot.name_ar) || !isTextOrNull(snapshot.image)) return null;
  const price = snapshot.price;
  if (!isObject(price) || !isText(price.amount) || !AMOUNT.test(price.amount) || (price.currency !== 'IQD' && price.currency !== 'USD')) return null;
  const axes: CartAxisLabel[] = [];
  if (!Array.isArray(snapshot.axes)) return null;
  for (const raw of snapshot.axes) {
    const axis = axisOf(raw);
    if (!axis) return null;
    axes.push(axis);
  }
  const unit = snapshot.unit;
  if (unit !== null && !(isObject(unit) && isText(unit.name) && isText(unit.symbol))) return null;
  return {
    item_id: value.item_id,
    product_id: value.product_id,
    quantity,
    snapshot: {
      name: snapshot.name,
      name_ar: snapshot.name_ar,
      axes,
      price: { amount: price.amount, currency: price.currency },
      image: snapshot.image,
      unit: unit === null ? null : { name: (unit as { name: string }).name, symbol: (unit as { symbol: string }).symbol },
    },
  };
}

/** The lines a storage value holds: none for anything that is not a cart of this version; a line that is not a line is dropped. */
function parseLines(raw: string | null): CartLine[] {
  if (raw === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Not JSON: a cart some other code or the buyer's hand wrote. Starting empty is the cart's answer; the next change replaces it.
    return [];
  }
  if (!isObject(parsed) || parsed.version !== CART_VERSION || !Array.isArray(parsed.lines)) return [];
  const lines: CartLine[] = [];
  for (const candidate of parsed.lines) {
    const line = lineOf(candidate);
    if (line && !lines.some((kept) => kept.item_id === line.item_id) && lines.length < MAX_CART_LINES) lines.push(line);
  }
  return lines;
}

const clampQuantity = (quantity: number): number => Math.min(MAX_LINE_QUANTITY, Math.max(1, Math.round(quantity)));

function copyOf(input: CartLineInput): CartLine {
  return {
    item_id: input.item_id,
    product_id: input.product_id,
    quantity: input.quantity,
    snapshot: { ...input.snapshot, price: { ...input.snapshot.price }, axes: input.snapshot.axes.map((axis) => ({ ...axis })), unit: input.snapshot.unit ? { ...input.snapshot.unit } : null },
  };
}

export function createCartStore({ siteId, storage, onStorageError }: CartStoreOptions): CartStoreWithReload {
  const key = cartStorageKey(siteId);
  const listeners = new Set<() => void>();
  let reported = false;

  const report = (error: unknown) => {
    if (reported) return;
    reported = true;
    onStorageError?.(error);
  };

  const read = (): string | null => {
    try {
      return storage.getItem(key);
    } catch (error) {
      report(error);
      return null;
    }
  };

  let current: readonly CartLine[] = Object.freeze(parseLines(read()));

  const notify = () => {
    for (const listener of [...listeners]) listener();
  };

  const persist = () => {
    try {
      if (current.length === 0) storage.removeItem(key);
      else storage.setItem(key, JSON.stringify({ version: CART_VERSION, lines: current }));
    } catch (error) {
      // The cart goes on in memory: a buyer who cannot be remembered can still buy.
      report(error);
    }
  };

  const replace = (lines: CartLine[]) => {
    current = Object.freeze(lines);
    persist();
    notify();
  };

  return {
    count: () => current.reduce((sum, line) => sum + line.quantity, 0),

    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },

    lines: () => current,

    add(input) {
      if (!Number.isInteger(input.quantity) || input.quantity < 1) throw new Error(`The quantity must be a whole number of at least one: ${input.quantity}`);
      const existing = current.find((line) => line.item_id === input.item_id);
      if (existing) {
        const merged = { ...copyOf(input), quantity: clampQuantity(existing.quantity + input.quantity) };
        replace(current.map((line) => (line === existing ? merged : line)));
        return;
      }
      if (current.length >= MAX_CART_LINES) throw new CartFullError();
      replace([...current, { ...copyOf(input), quantity: clampQuantity(input.quantity) }]);
    },

    setQuantity(itemId, quantity) {
      if (!Number.isFinite(quantity)) return;
      const existing = current.find((line) => line.item_id === itemId);
      const next = clampQuantity(quantity);
      if (!existing || existing.quantity === next) return;
      replace(current.map((line) => (line === existing ? { ...line, quantity: next } : line)));
    },

    remove(itemId) {
      if (!current.some((line) => line.item_id === itemId)) return;
      replace(current.filter((line) => line.item_id !== itemId));
    },

    clear() {
      if (current.length === 0) return;
      replace([]);
    },

    totals() {
      const count = current.reduce((sum, line) => sum + line.quantity, 0);
      if (current.length === 0) return { count, lines: 0, subtotal: null, mixedCurrency: false };
      const currency = current[0].snapshot.price.currency;
      if (current.some((line) => line.snapshot.price.currency !== currency)) return { count, lines: current.length, subtotal: null, mixedCurrency: true };
      const amount = current.reduce((sum, line) => addAmounts(sum, multiplyAmount(line.snapshot.price.amount, line.quantity)), '0');
      return { count, lines: current.length, subtotal: { amount, currency }, mixedCurrency: false };
    },

    reload() {
      const lines = parseLines(read());
      if (JSON.stringify(lines) === JSON.stringify(current)) return;
      current = Object.freeze(lines);
      notify();
    },
  };
}

// ---------------------------------------------------------------------------
// The cart the page connects
// ---------------------------------------------------------------------------

const STORE_KEY = '__wsCartStore';
const SITE_KEY = '__wsCartSite';
const STOP_KEY = '__wsCartFollowTabs';
const LISTENERS_KEY = '__wsCartConnectionListeners';

type CartGlobals = {
  [STORE_KEY]?: CartStore;
  [SITE_KEY]?: string;
  [STOP_KEY]?: () => void;
  [LISTENERS_KEY]?: Set<() => void>;
};

const globals = (): CartGlobals => globalThis as unknown as CartGlobals;

function connectionListeners(): Set<() => void> {
  const holder = globals();
  return (holder[LISTENERS_KEY] ??= new Set());
}

/** The connected cart, or the unconnected stand-in. */
export function getCartStore(): CartStore {
  return globals()[STORE_KEY] ?? unconnectedCartStore;
}

/** Connect a cart, or disconnect it with null. Elements already subscribed follow the change. */
export function connectCartStore(store: CartStore | null): void {
  const holder = globals();
  holder[STOP_KEY]?.();
  holder[STOP_KEY] = undefined;
  holder[SITE_KEY] = undefined;
  holder[STORE_KEY] = store ?? undefined;
  for (const listener of [...connectionListeners()]) listener();
}

/** Subscribe to the cart's changes, following a cart connected later; returns the way to stop. */
export function subscribeToCart(listener: () => void): () => void {
  let stop = getCartStore().subscribe(listener);
  const onConnection = () => {
    stop();
    stop = getCartStore().subscribe(listener);
    listener();
  };
  connectionListeners().add(onConnection);
  return () => {
    connectionListeners().delete(onConnection);
    stop();
  };
}

export const cartCount = (): number => getCartStore().count();

function memoryStorage(): CartStorage {
  const data = new Map<string, string>();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}

/**
 * Connects the page's cart: the browser's localStorage for this site, kept in
 * step with the other tabs of the same site. Every store element on the page
 * calls it when it starts; the second call for the same site changes nothing.
 * In the builder canvas and on the server there is no browser cart (nothing
 * calls it there), so this does nothing outside a browser.
 */
export function connectBrowserCart(siteId: string): void {
  if (typeof window === 'undefined') return;
  const holder = globals();
  if (holder[STORE_KEY] && holder[SITE_KEY] === siteId) return;

  let storage: CartStorage;
  try {
    storage = window.localStorage;
  } catch (error) {
    // Reading localStorage itself throws when the browser blocks site data: the cart then lasts for the visit.
    console.error('[store] the browser would not give the cart a place to keep itself; it will last for this visit only', error);
    storage = memoryStorage();
  }
  const store = createCartStore({
    siteId,
    storage,
    onStorageError: (error) => console.error('[store] the cart could not be kept in the browser; it will last for this visit only', error),
  });
  const key = cartStorageKey(siteId);
  const onStorage = (event: StorageEvent) => {
    // `null` is the whole storage cleared.
    if (event.key === key || event.key === null) store.reload();
  };
  window.addEventListener('storage', onStorage);
  connectCartStore(store);
  holder[STOP_KEY] = () => window.removeEventListener('storage', onStorage);
  holder[SITE_KEY] = siteId;
}
