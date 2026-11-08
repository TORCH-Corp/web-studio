/**
 * The buyer's cart as the store elements see it (part 2, session W4).
 *
 * W5 builds the cart (a client module over localStorage, keyed by site) and
 * W6 reads it for the cart and checkout elements. This file is the seam the
 * W4 elements are written against: the cart indicator reads the count and
 * subscribes to it, and "Add to cart" on a card without variants adds a line.
 * W5 implements `CartStore` and calls `connectCartStore` once when the
 * published page starts; until it does, nothing is connected and adding to the
 * cart fails loudly rather than being dropped.
 *
 * The connected store is kept on `globalThis`, not in a module variable: Next
 * bundles client code into chunks, and the module that connects the cart and
 * the chunk of an element that reads it need not be the same copy of this file
 * (the same reason lib/knex-client.ts and lib/platform/site.ts keep theirs
 * there). It also lets a test put a fake in place before the page starts.
 */

export interface CartLineInput {
  /** The item to sell: the variant's own item id when the product has variants, else the product's. */
  item_id: string;
  quantity: number;
  /** What the cart shows for the line; display only, prices are read again at checkout (PRD V1.1). */
  snapshot: {
    name: string;
    name_ar: string | null;
    price: { amount: string; currency: 'IQD' | 'USD' };
    image: string | null;
  };
}

export interface CartStore {
  /** The number the cart indicator shows: the quantity of all the cart's lines. */
  count(): number;
  /** Calls `listener` whenever the cart changes; returns the way to stop. */
  subscribe(listener: () => void): () => void;
  add(line: CartLineInput): void;
}

export class CartStoreNotConnectedError extends Error {
  constructor() {
    super('The cart is not connected: nothing called connectCartStore() (lib/platform/store-elements/cart-store.ts)');
    this.name = 'CartStoreNotConnectedError';
  }
}

/** What stands in until a cart is connected: empty, and it refuses to add. */
export const unconnectedCartStore: CartStore = {
  count: () => 0,
  subscribe: () => () => {},
  add: () => {
    throw new CartStoreNotConnectedError();
  },
};

const STORE_KEY = '__wsCartStore';
const LISTENERS_KEY = '__wsCartConnectionListeners';

type CartGlobals = {
  [STORE_KEY]?: CartStore;
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

/** Connect the cart (W5), or disconnect it with null. Elements already subscribed follow the change. */
export function connectCartStore(store: CartStore | null): void {
  globals()[STORE_KEY] = store ?? undefined;
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
