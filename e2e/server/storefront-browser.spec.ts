/**
 * Part 2's store as a buyer meets it, in a real browser on the deployed service
 * (session D1, server mode), and the check that nothing leaves for a public host.
 *
 * A site of the test organization with the store pages (home, products, product,
 * cart, checkout, confirmation: the elements of W4 to W6 placed through the layers
 * API, as Task B's templates will place them in the builder) is published on
 * https://{slug}.sites.torchcorp.com. A browser opens /products and finds the
 * fixture item from Product & Services with its real image, adds it to the cart,
 * checks out with the test buyer, and reads Sales's code on the confirmation; the
 * order is then cancelled. Every request the store pages make, and every request the
 * builder makes when it opens that site, is recorded: the only hosts allowed are
 * Web Studio's own (the builder's host and the site's host). Fonts come from the
 * platform mirror, scripts and styles from the app, images from Document Center
 * through the site; nothing goes to Google Fonts, a CDN or an analytics host,
 * except the one beacon Cloudflare's edge adds to the builder's HTML (EDGE_INJECTED).
 *
 * Session 26: the site carries a Google font of its own (IBM Plex Sans Arabic on
 * the body, as TORCH's templates have it), so the same check covers a published
 * page's own font: its rules are inlined from the mirror, its files are on the
 * site's host, and no request goes to fonts.gstatic.com.
 */

import { chromium, expect, test, type APIRequestContext, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { draftPages, signInWithToken } from '../helpers';
import { accessToken, cancelOpenOrders, createSellingSite, deleteSite, ensureStoreItem, STORE_ITEM, TEST_BUYER, type SellingSite } from './real-services';

test.describe.configure({ mode: 'serial' });

const RUN = Date.now().toString(36);

/**
 * The one public host the builder's page contacts that the app does not ask for. `web-studio.torchcorp.com` is
 * proxied by Cloudflare, whose edge adds its Web Analytics beacon (`static.cloudflareinsights.com/beacon.min.js`)
 * to every HTML answer: the same route read from the origin (127.0.0.1:6030) has no such script, and nothing in the
 * app or in docker/nginx names it (checked 8 Nov 2026). The sites domain is DNS only, so a published store page is
 * never touched. Turning the beacon off is Cloudflare's dashboard (Web Analytics) or a `Cache-Control: no-transform`
 * answer: the owner's call, OPEN_QUESTIONS 53. Until then the run records it as a known exception instead of
 * failing, and still fails on any other host.
 */
const EDGE_INJECTED = ['static.cloudflareinsights.com'];

let baseURL: string;
let builderHost: string;
let api: APIRequestContext;
let browser: Browser;
let store: SellingSite;

const element = (id: string, name: string, extra: Record<string, unknown> = {}) => ({ id, name, classes: 'w-full', settings: { tag: 'div', ...extra }, children: [] });
const indicator = (id: string) => ({ id, name: 'cartIndicator', classes: 'w-fit', settings: { tag: 'div' }, children: [] });
const grid = (id: string) => element(id, 'productGrid', { store: { productGrid: {} } });
const detail = (id: string) => element(id, 'productDetail', { store: { productDetail: { product: null } } });
const body = (...children: unknown[]) => [{ id: 'body', name: 'body', classes: 'font-[IBM_Plex_Sans_Arabic]', children }];

async function putLayers(pageId: string, layers: unknown[]): Promise<void> {
  const response = await api.put(`/ycode/api/layers?page_id=${pageId}`, { data: { layers } });
  expect(response.status(), await response.text()).toBe(200);
}
async function createPage(slug: string, settings: Record<string, unknown> = {}): Promise<string> {
  const response = await api.post('/ycode/api/pages', { data: { name: slug, slug, settings } });
  expect(response.status() < 300, await response.text()).toBe(true);
  return (await response.json()).data.id as string;
}

/** Every network host a context contacts (pages, scripts, images, fonts, fetches, websockets), by name and port. */
function watchHosts(context: BrowserContext): Set<string> {
  const hosts = new Set<string>();
  const note = (raw: string) => {
    const url = new URL(raw);
    if (['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol)) hosts.add(url.host);
  };
  context.on('request', (request) => note(request.url()));
  context.on('page', (page: Page) => page.on('websocket', (socket) => note(socket.url())));
  return hosts;
}

const cartBadge = (page: Page) => page.locator('[data-ws-store="cartIndicator"] .ws-badge').first();
const cartEl = (page: Page) => page.locator('[data-ws-store="cart"]');
const checkoutEl = (page: Page) => page.locator('[data-ws-store="checkout"]');
const confirmationEl = (page: Page) => page.locator('[data-ws-store="orderConfirmation"]');

test.beforeAll(async ({ baseURL: configured }) => {
  baseURL = configured!;
  builderHost = new URL(baseURL).host;
  const token = await accessToken();
  api = await signInWithToken(baseURL, token);
  await ensureStoreItem(token);
  browser = await chromium.launch();

  // The store's pages, then one publish. The site is created unpublished so the pages go in first.
  store = await createSellingSite(api, RUN, { slugPrefix: 'e2e-web', name: 'E2E storefront', deliveryFee: 2500, publishIt: false });
  const opened = await api.get(`/ycode/api/platform/sites/${store.site.id}/open`, { maxRedirects: 0 });
  expect(opened.status()).toBe(303);
  // The site's own font, as the builder installs a Google font (session 26).
  const font = await api.post('/ycode/api/fonts', { data: { name: 'ibm-plex-sans-arabic', family: 'IBM Plex Sans Arabic', type: 'google', variants: [], weights: ['400', '700'], category: 'sans-serif' } });
  expect(font.status() < 300, await font.text()).toBe(true);
  const home = (await draftPages(api)).find((page) => page.is_index)!;
  await putLayers(home.id, body(indicator('cart-home'), grid('grid-home')));
  await putLayers(await createPage('products'), body(indicator('cart-products'), grid('grid-products')));
  await putLayers(await createPage('product', { store: { kind: 'product' } }), body(indicator('cart-product'), detail('detail')));
  await putLayers(await createPage('cart', { store: { kind: 'cart' } }), body(indicator('cart-cart'), element('cart', 'cart')));
  await putLayers(await createPage('checkout', { store: { kind: 'checkout' } }), body(indicator('cart-checkout'), element('checkout', 'checkout')));
  await putLayers(await createPage('thanks', { store: { kind: 'confirmation' } }), body(indicator('cart-thanks'), element('confirmation', 'orderConfirmation')));
  const published = await api.post('/ycode/api/publish', { data: { publishAll: true } });
  expect(published.status(), await published.text()).toBe(200);
});

test.afterAll(async () => {
  await cancelOpenOrders(api, store?.site.id);
  await deleteSite(api, store?.site);
  await api?.dispose();
  await browser?.close();
});

test('a buyer finds the real item on /products with its image, adds it, checks out and reads the order\'s code; every request stays on the site\'s own host', async () => {
  const context = await browser.newContext({ baseURL: `https://${store.host}`, viewport: { width: 1280, height: 900 } });
  const hosts = watchHosts(context);
  try {
    const page = await context.newPage();

    const products = await page.goto('/products');
    expect(products?.status()).toBe(200);
    // The page's own font: rules from the platform mirror, files on this host, no Google host named anywhere.
    const html = await products!.text();
    expect(html).toContain('id="ycode-google-fonts"');
    expect(html).toContain('/ycode/api/fonts/published/ibmplexsansarabic/');
    expect(html).not.toMatch(/fonts\.gstatic\.com|fonts\.googleapis\.com/);
    expect(products!.headers().link ?? '').not.toMatch(/gstatic|googleapis/);
    const card = page.locator('[data-ws-store="productGrid"] article.ws-card', { hasText: STORE_ITEM.name });
    await expect(card).toBeVisible({ timeout: 30_000 });
    await expect(card).toContainText('25,000');
    // The real image, through the site from Document Center.
    const image = card.locator('img').first();
    await expect(image).toHaveAttribute('src', /\/store-media\//);
    await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);

    await card.getByRole('button', { name: /^Add to cart$/ }).click();
    await expect(cartBadge(page)).toHaveText('1');

    await page.getByRole('link', { name: 'Cart: 1 item' }).click();
    await expect(page).toHaveURL('/cart');
    await expect(cartEl(page).locator('.ws-line .ws-line-name')).toHaveText([STORE_ITEM.name]);
    await expect(cartEl(page).locator('.ws-sum-row', { hasText: /^Subtotal/ }).locator('.ws-sum-v')).toHaveText('25,000 IQD');
    await expect(cartEl(page).locator('.ws-sum-row', { hasText: /^Delivery fee/ }).locator('.ws-sum-v')).toHaveText('2,500 IQD');
    await expect(cartEl(page).locator('.ws-sum-row', { hasText: /^Total/ }).locator('.ws-sum-v')).toHaveText('27,500 IQD');

    await cartEl(page).getByRole('link', { name: 'Checkout' }).click();
    await expect(page).toHaveURL('/checkout');
    const form = checkoutEl(page);
    const place = form.getByRole('button', { name: /^Place order/ });
    await expect(place).toContainText('27,500 IQD');
    await form.getByLabel('Full name').fill(TEST_BUYER.name);
    await form.getByLabel('Phone number').fill(TEST_BUYER.phone);
    await form.getByLabel('City').selectOption({ label: 'Baghdad' });
    await form.getByLabel('Address', { exact: true }).fill('E2E browser street 3');
    await place.click();

    await expect(page).toHaveURL(/\/thanks\?order=[0-9a-f-]{36}$/);
    const code = confirmationEl(page).locator('[data-order-code]');
    await expect(code).toHaveText(/^SO-\d{4}-\d{4,}$/);
    const shown = (await code.textContent())!.trim();

    // Sales has that order, a draft, for this site.
    const drafts = await api.get(`/ycode/api/platform/orders?site_id=${store.site.id}&status=draft`);
    expect(drafts.status(), await drafts.text()).toBe(200);
    expect(((await drafts.json()).data as Array<{ code: string }>).map((order) => order.code)).toEqual([shown]);

    // The cart is over and the browser's pages never left the site.
    expect(await page.evaluate((key) => window.localStorage.getItem(key), `ws-cart:${store.site.id}`)).toBeNull();
    await page.waitForLoadState('networkidle');
  } finally {
    await context.close();
  }
  expect([...hosts], 'hosts the published store pages contacted').toEqual([store.host]);
});

test('the same pages in Arabic load from the site\'s own host too, right to left', async () => {
  const context = await browser.newContext({ baseURL: `https://${store.host}`, viewport: { width: 1280, height: 900 } });
  const hosts = watchHosts(context);
  try {
    const page = await context.newPage();
    const response = await page.goto('/ar/products');
    expect(response?.status()).toBe(200);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('[data-ws-store="productGrid"] article.ws-card', { hasText: STORE_ITEM.name_ar })).toBeVisible({ timeout: 30_000 });
    // Let the fonts settle: one that is not on the platform mirror would be asked of a public host and show in the hosts below.
    await page.evaluate(() => document.fonts.ready);
    await page.waitForLoadState('networkidle');
  } finally {
    await context.close();
  }
  expect([...hosts], 'hosts the Arabic store pages contacted').toEqual([store.host]);
});

test('the builder opens the site, its library and its Store elements, and every request stays on the builder\'s own host', async () => {
  const context = await browser.newContext({ baseURL, storageState: await api.storageState(), viewport: { width: 1600, height: 1000 } });
  const hosts = watchHosts(context);
  try {
    const page = await context.newPage();
    await page.goto(`/ycode/api/platform/sites/${store.site.id}/open`);
    await expect(page.getByRole('tab', { name: 'Pages' })).toBeVisible({ timeout: 90_000 });
    await page.getByRole('tab', { name: 'Layers' }).click();
    await page.getByRole('tabpanel', { name: 'Layers' }).getByText('Layers', { exact: true }).locator('xpath=following::button[1]').click();
    const elements = page.getByRole('tabpanel', { name: 'Elements' });
    for (const name of ['Product grid', 'Cart', 'Checkout', 'Order confirmation']) await expect(elements.getByText(name, { exact: true })).toBeVisible();
    await page.getByRole('tab', { name: 'Layouts' }).click();
    await page.waitForLoadState('networkidle');
  } finally {
    await context.close();
  }
  const edge = [...hosts].filter((host) => EDGE_INJECTED.includes(host));
  if (edge.length > 0) {
    test.info().annotations.push({ type: 'known exception', description: `${edge.join(', ')}: injected into the builder's HTML by Cloudflare's edge, not by the app (OPEN_QUESTIONS 53)` });
  }
  expect([...hosts].filter((host) => !EDGE_INJECTED.includes(host)), 'hosts the builder contacted').toEqual([builderHost]);
});
