/**
 * How a published page reports its own view (part 3, session W7) and the store's
 * add to cart (session W8).
 *
 * The page is served from a cache, so the server cannot count it as it is
 * rendered: the page says "I am on a screen" itself, with one small POST to
 * its own host after it has loaded (lib/platform/VisitBeacon.tsx). Nothing is
 * read from or written to the browser's storage, and no cookie is set.
 *
 * Kept free of Next and React imports so it runs under `node --test`.
 */

/** The route, by its public name (lib/platform/public-path.ts): the same host as the page. */
export const VISIT_URL = '/studio/api/visits';

/** The host of the page's referrer, or '' when there is none or it is not an address. Only the host leaves the browser. */
export function referrerHostOf(referrer: string): string {
  if (!referrer) return '';
  try {
    return new URL(referrer).hostname.toLowerCase();
  } catch {
    return ''; // not an address: the view counts as direct
  }
}

/** The body the route reads. */
export function visitBody(pageId: string, pathname: string, referrer: string): string {
  return JSON.stringify({ page_id: pageId, path: pathname, referrer: referrerHostOf(referrer) });
}

/** The body of an add to cart: the kind and nothing else. Nothing about the cart, the product or the visitor leaves the browser. */
export const ADD_TO_CART_BODY = JSON.stringify({ kind: 'add_to_cart' });

interface VisitDocument {
  referrer: string;
  /** True while the browser renders the page ahead of a visit (a prerender); the view counts when it is shown. */
  prerendering?: boolean;
  addEventListener(type: 'prerenderingchange', listener: () => void, options: { once: true }): void;
  removeEventListener(type: 'prerenderingchange', listener: () => void): void;
}

export interface VisitBrowser {
  document: VisitDocument;
  location: { pathname: string };
  fetch: (
    url: string,
    init: { method: 'POST'; headers: Record<string, string>; body: string; keepalive: true },
  ) => Promise<{ body?: { cancel(): Promise<void> } | null }>;
}

/**
 * One report to the page's own host. The answer is not read. A refusal has a body,
 * and a body left unread keeps the request open in the browser. A failed request
 * is dropped: the count is the site owner's, and a visitor's page must not change
 * because it was not counted.
 */
function post(browser: VisitBrowser, body: string): void {
  browser
    .fetch(VISIT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true, // the request outlives a visitor who leaves at once
    })
    .then((response) => response.body?.cancel())
    .catch(() => {});
}

/** The view sent last, so a page that mounts twice for one view (React's development double mount) is counted once. */
let lastSent: string | null = null;

/** Forget the view sent last (for tests). */
export function forgetLastView(): void {
  lastSent = null;
}

/**
 * Report a view of `pageId` at the browser's current path. A page the browser
 * prerendered waits until it is shown. Returns what undoes the wait.
 *
 * A failed request is dropped (`post`).
 */
export function reportView(pageId: string, browser: VisitBrowser): () => void {
  const send = () => {
    const pathname = browser.location.pathname;
    const view = `${pageId} ${pathname}`;
    if (view === lastSent) return;
    lastSent = view;
    post(browser, visitBody(pageId, pathname, browser.document.referrer));
  };
  if (browser.document.prerendering) {
    browser.document.addEventListener('prerenderingchange', send, { once: true });
    return () => browser.document.removeEventListener('prerenderingchange', send);
  }
  send();
  return () => {};
}

/**
 * The browser the store's add to cart reports to: the one a counted page
 * connected. Kept on `globalThis` for the reason the cart is
 * (lib/platform/store-elements/cart-store.ts): Next bundles client code into
 * chunks, and the module that connects it and the one an element calls need not
 * be the same copy of this file.
 */
const globalForClient = globalThis as unknown as { __webStudioVisitBrowser?: VisitBrowser };

/**
 * Connect the page's browser, so that the store's add to cart can report. Called
 * by the page's beacon (lib/platform/VisitBeacon.tsx), which a published page
 * mounts and the builder's canvas and preview never do: where nothing is
 * connected, `reportAddToCart` does nothing. Returns what disconnects it.
 */
export function connectVisitBrowser(browser: VisitBrowser): () => void {
  globalForClient.__webStudioVisitBrowser = browser;
  return () => {
    if (globalForClient.__webStudioVisitBrowser === browser) delete globalForClient.__webStudioVisitBrowser;
  };
}

/**
 * Report an add to cart: one POST to the page's own host, `{ kind: 'add_to_cart' }`.
 * Sent on every add; the server keeps one per visitor and day. Does nothing when
 * no counted page is connected.
 */
export function reportAddToCart(): void {
  const browser = globalForClient.__webStudioVisitBrowser;
  if (browser) post(browser, ADD_TO_CART_BODY);
}
