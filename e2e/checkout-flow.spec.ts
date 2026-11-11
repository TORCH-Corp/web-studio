/**
 * Part 2, session W6 "done when": a buyer reviews the cart, checks out and
 * reads the confirmation, end to end on a published site with the platform
 * stubs.
 *
 * A site with five store pages (the home page with the grid, `products` with
 * the grid, `product` with the product page, `cart`, `checkout` and `thanks`
 * holding the cart, checkout and confirmation elements) is published, and a
 * browser visits it at its own host, so the page's Origin is the host the
 * checkout route screens against: Chromium maps `*.sites.test` to the app.
 * The flow: add two items and a variant, open the cart, change a quantity,
 * remove one, check out, read the code. Then the error paths: an invalid
 * phone, an item that became unavailable, the Sales stub down (the cart is
 * kept), a reload on the checkout page, a double click on Place order. The
 * stubs are e2e/platform-stub.ts (Product & Services, Organization Setup) and
 * e2e/order-services-stub.ts (Contact Center, Sales), which record every call.
 *
 * The catalogue organization of e2e/platform-fixtures.ts: the Desk lamp (25,000
 * IQD), the Garden hose (15,000) and the Linen shirt, whose Small White variant
 * is 35,000. The site sells from Clothing, Home and Garden.
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium, expect, request, test, type APIRequestContext, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { HONEYPOT_FIELD_NAME } from '../lib/form-spam-settings';
import { createSite, draftPages, openSite, publish, signIn, TEST_SITES_DOMAIN, type SiteRecord } from './helpers';
import { BRANCH, CATALOGUE_ORG, CATEGORY, ITEM } from './platform-fixtures';

test.describe.configure({ mode: 'serial' });

const RUN = Date.now().toString(36);
const PORT = Number(process.env.E2E_PORT || 3102);
const PLATFORM = `http://127.0.0.1:${Number(process.env.E2E_PLATFORM_PORT || PORT + 3)}`;
const SLUG = `cf-${RUN}`;
const HOST = `${SLUG}.${TEST_SITES_DOMAIN}`;
const ORIGIN = `http://${HOST}:${PORT}`;
const OWNER = { sub: '79797979-7979-4979-8979-797979797979', email: 'owner-checkout-flow@example.com', name: 'Checkout Flow Owner', org: CATALOGUE_ORG };

/** Seven digits of this run, so the stub's persons from an earlier run never match. */
const DIGITS = String(Date.now()).slice(-7);
const PHONE = `0770 ${DIGITS.slice(0, 3)} ${DIGITS.slice(3)}`;
const PHONE_WITH_CODE = `+964 771 ${DIGITS.slice(0, 3)} ${DIGITS.slice(3)}`;

let baseURL: string;
let browser: Browser;
let owner: APIRequestContext;
let site: SiteRecord;
let fee = 5000;

const money = (amount: number, currency = 'IQD') => `${amount.toLocaleString('en-US')} ${currency}`;

// ---------------------------------------------------------------------------
// The stubs and the site
// ---------------------------------------------------------------------------

async function control(path: string, data: unknown): Promise<void> {
  const context = await request.newContext();
  try {
    expect((await context.post(`${PLATFORM}${path}`, { data })).status()).toBe(200);
  } finally {
    await context.dispose();
  }
}
const servicesDown = (services: string[]) => control('/__down', { services });
const salesDelay = (ms: number) => control('/__sales/delay', { ms });
const setItem = (id: string, change: { status?: string; base_price?: number | null }) => control('/__item', { id, ...change });

interface Call {
  method: string;
  path: string;
  entityId: string | null;
  body: Record<string, any> | null;
  status: number;
  response: Record<string, any>;
}
async function calls(service: 'contact-center' | 'sales'): Promise<Call[]> {
  const context = await request.newContext();
  try {
    return ((await (await context.get(`${PLATFORM}/__calls?service=${service}`)).json()) as { calls: Call[] }).calls;
  } finally {
    await context.dispose();
  }
}
/** The orders Sales made (201) since `before` was read. */
const ordersSince = async (before: Call[]) => (await calls('sales')).slice(before.length).filter((call) => call.method === 'POST' && call.path === '/internal/orders' && call.status === 201);
/** Every attempt at an order Sales saw since `before` was read, made or refused. */
const attemptsSince = async (before: Call[]) => (await calls('sales')).slice(before.length).filter((call) => call.method === 'POST' && call.path === '/internal/orders');

async function patchStore(data: Record<string, unknown>): Promise<void> {
  const response = await owner.patch(`/ycode/api/platform/sites/${site.id}/store`, { data });
  expect(response.status(), await response.text()).toBe(200);
}
/** Any change to the store settings makes the next store read ask the stubs again (catalogue.spec.ts). */
const forgetCatalogue = () => patchStore({ delivery_fee: (fee += 250) });

async function putLayers(pageId: string, layers: unknown[]): Promise<void> {
  const response = await owner.put(`/ycode/api/layers?page_id=${pageId}`, { data: { layers } });
  expect(response.status(), await response.text()).toBe(200);
}
async function createPage(api: APIRequestContext, slug: string, settings: Record<string, unknown> = {}): Promise<string> {
  const response = await api.post('/ycode/api/pages', { data: { name: slug, slug, settings } });
  expect(response.status() < 300, await response.text()).toBe(true);
  return (await response.json()).data.id as string;
}

const element = (id: string, name: string, extra: Record<string, unknown> = {}) => ({ id, name, classes: 'w-full', settings: { tag: 'div', ...extra }, children: [] });
const indicator = (id: string) => ({ id, name: 'cartIndicator', classes: 'w-fit', settings: { tag: 'div' }, children: [] });
const grid = (id: string) => element(id, 'productGrid', { store: { productGrid: {} } });
const detail = (id: string) => element(id, 'productDetail', { store: { productDetail: { product: null } } });
const body = (...children: unknown[]) => [{ id: 'body', name: 'body', classes: '', children }];

/** The site's form-spam setting, which the checkout's rate limit reads: every request of this spec comes from one address. */
async function spamSetting(rateLimitMaxSubmissions: number): Promise<void> {
  const response = await owner.put('/ycode/api/settings/form_spam_protection', {
    data: { value: { enabled: true, rateLimitEnabled: true, rateLimitMaxSubmissions, allowExternalSubmissions: false } },
  });
  expect(response.status(), await response.text()).toBe(200);
}

test.beforeAll(async ({ baseURL: configured }) => {
  baseURL = configured!;
  await servicesDown([]);
  await control('/__rate', { found: true });
  await control('/__items/reset', {});
  await salesDelay(0);
  // A browser that opens the site at its own host: the page's Origin is then the host the checkout screens against.
  browser = await chromium.launch({ args: [`--host-resolver-rules=MAP *.${TEST_SITES_DOMAIN} 127.0.0.1`] });
  owner = await signIn(baseURL, OWNER);
  site = await createSite(owner, { name: 'Checkout Flow Store', slug: SLUG, languages: ['en', 'ar'], default_language: 'en' });
  expect(site.hosts[0]).toBe(HOST);
  expect((await openSite(owner, site.id)).status()).toBe(303);
  await patchStore({ branch_id: BRANCH.catalogue, category_ids: [CATEGORY.home, CATEGORY.clothing, CATEGORY.garden], delivery_fee: fee, selling: true });
  await spamSetting(1000);

  const home = (await draftPages(owner)).find((page) => page.is_index)!;
  await putLayers(home.id, body(indicator('cart-home'), grid('grid-home')));
  await putLayers(await createPage(owner, 'products'), body(indicator('cart-products'), grid('grid-products')));
  await putLayers(await createPage(owner, 'product', { store: { kind: 'product' } }), body(indicator('cart-product'), detail('detail')));
  await putLayers(await createPage(owner, 'cart', { store: { kind: 'cart' } }), body(indicator('cart-cart'), element('cart', 'cart')));
  await putLayers(await createPage(owner, 'checkout', { store: { kind: 'checkout' } }), body(indicator('cart-checkout'), element('checkout', 'checkout')));
  await putLayers(await createPage(owner, 'thanks', { store: { kind: 'confirmation' } }), body(indicator('cart-thanks'), element('confirmation', 'orderConfirmation')));
  await publish(owner);
});

test.afterAll(async () => {
  await servicesDown([]);
  await control('/__rate', { found: true });
  await control('/__items/reset', {});
  await salesDelay(0);
  if (site) await owner.delete(`/ycode/api/platform/sites/${site.id}`);
  await owner?.dispose();
  await browser?.close();
});

// ---------------------------------------------------------------------------
// The buyer's browser
// ---------------------------------------------------------------------------

async function visitor(options: { viewport?: { width: number; height: number }; reducedMotion?: 'reduce' | 'no-preference' } = {}): Promise<BrowserContext> {
  return browser.newContext({ baseURL: ORIGIN, viewport: options.viewport ?? { width: 1280, height: 900 }, reducedMotion: options.reducedMotion });
}

interface Posted {
  checkout_id: string;
  buyer: Record<string, string>;
  lines: Array<{ item_id: string; quantity: string }>;
  locale: string;
}
/** Every checkout the page posted, in order. */
function watchCheckouts(page: Page): Posted[] {
  const posted: Posted[] = [];
  page.on('request', (req) => {
    if (req.method() === 'POST' && new URL(req.url()).pathname === '/studio/api/store/checkout') posted.push(req.postDataJSON() as Posted);
  });
  return posted;
}

const CART_KEY = () => `ws-cart:${site.id}`;
type StoredCart = { version: number; checkout_id?: string; lines: Array<{ item_id: string; product_id: string; quantity: number; snapshot: { price: { amount: string; currency: string } } }> } | null;
const readCart = (page: Page) => page.evaluate((key) => JSON.parse(window.localStorage.getItem(key) ?? 'null') as StoredCart, CART_KEY());

const cartBadge = (page: Page) => page.locator('[data-ws-store="cartIndicator"] .ws-badge').first();
const cartEl = (page: Page) => page.locator('[data-ws-store="cart"]');
const checkoutEl = (page: Page) => page.locator('[data-ws-store="checkout"]');
const confirmationEl = (page: Page) => page.locator('[data-ws-store="orderConfirmation"]');
const lineOf = (page: Page, name: string) => cartEl(page).locator('.ws-line', { hasText: name });
const summaryRow = (scope: ReturnType<Page['locator']>, label: string) => scope.locator('.ws-sum-row', { hasText: new RegExp(`^${label}`) }).locator('.ws-sum-v');
const placeOrder = (page: Page) => checkoutEl(page).getByRole('button', { name: /^(Place order|تأكيد الطلب)/ });
const alertOf = (page: Page, banner: string) => checkoutEl(page).locator(`[data-banner="${banner}"]`);

/** "Add to cart" on a plain item's card in the grid of the page that is open. */
async function addFromGrid(page: Page, name: string): Promise<void> {
  const card = page.locator('[data-ws-store="productGrid"] article.ws-card', { hasText: name });
  await card.getByRole('button', { name: /^(Add to cart|أضف إلى السلة)$/ }).click();
}

/** Opens the products page and puts the named plain items in the cart. */
async function addPlainItems(page: Page, ...names: string[]): Promise<void> {
  await page.goto('/products');
  await expect(page.locator('[data-ws-store="productGrid"] article.ws-card').first()).toBeVisible();
  for (const [index, name] of names.entries()) {
    await addFromGrid(page, name);
    await expect(cartBadge(page)).toHaveText(String(index + 1));
  }
}

/** The checkout page, once the cart and the store's settings have been read: Place order is there with its total. */
async function openCheckout(page: Page): Promise<void> {
  await page.goto('/checkout');
  await expect(placeOrder(page)).toBeVisible();
  await expect(placeOrder(page)).toContainText('IQD');
}

async function fillForm(page: Page, values: { name?: string; phone?: string; city?: string; address?: string; landmark?: string; notes?: string } = {}): Promise<void> {
  const form = checkoutEl(page);
  const { name = 'Ali Hassan Kadhim', phone = PHONE, city = 'Baghdad', address = 'Karrada, district 903, alley 12, house 7', landmark = '', notes = '' } = values;
  await form.getByLabel('Full name').fill(name);
  await form.getByLabel('Phone number').fill(phone);
  if (city) await form.getByLabel('City').selectOption({ label: city });
  await form.getByLabel('Address', { exact: true }).fill(address);
  if (landmark) await form.getByLabel('Nearest landmark').fill(landmark);
  if (notes) await form.getByLabel('Notes').fill(notes);
}

const CODE = /^SO-\d{4}-\d{4}$/;

test('a publish writes where each store page lives, in each language, for the store elements to link to', async () => {
  const response = await owner.get('/ycode/api/settings/store_pages');
  expect(response.status(), await response.text()).toBe(200);
  expect((await response.json()).data).toEqual({
    product: { '*': '/product', ar: '/ar/product' },
    cart: { '*': '/cart', ar: '/ar/cart' },
    checkout: { '*': '/checkout', ar: '/ar/checkout' },
    confirmation: { '*': '/thanks', ar: '/ar/thanks' },
  });
});

test('a buyer adds two items and a variant, reviews the cart, changes a quantity, removes a line, checks out and reads the order\'s code', async () => {
  const salesBefore = await calls('sales');
  const context = await visitor();
  try {
    const page = await context.newPage();
    const posted = watchCheckouts(page);

    // Two plain items from their cards.
    await addPlainItems(page, 'Desk lamp', 'Garden hose');

    // A variant from the product page: Small White, 35,000 IQD.
    const [, product] = await Promise.all([
      page.waitForResponse((r) => new URL(r.url()).pathname === `/studio/api/store/products/${ITEM.shirt}`),
      page.goto(`/product/${ITEM.shirt}`),
    ]);
    expect(product?.status()).toBe(200);
    const detailEl = page.locator('[data-ws-store="productDetail"]');
    await detailEl.locator('fieldset', { hasText: 'Colour' }).getByRole('button', { name: 'White' }).click();
    await expect(detailEl.locator('.ws-pd-price')).toContainText('35,000 IQD');
    await detailEl.getByRole('button', { name: 'Add to cart' }).click();
    // The "added" notice and the cart indicator lead to the page with the cart role.
    await expect(detailEl.getByRole('link', { name: 'View cart' })).toHaveAttribute('href', '/cart');
    await expect(cartBadge(page)).toHaveText('3');
    await expect(page.getByRole('link', { name: 'Cart: 3 items' })).toHaveAttribute('href', '/cart');

    // The cart: three lines, the variant with its options, the amounts from the store's settings.
    await page.getByRole('link', { name: 'Cart: 3 items' }).click();
    await expect(page).toHaveURL('/cart');
    await expect(cartEl(page).getByRole('heading', { level: 1 })).toHaveText('Shopping cart');
    await expect(cartEl(page).locator('.ws-line .ws-line-name')).toHaveText(['Desk lamp', 'Garden hose', 'Linen shirt']);
    await expect(cartEl(page).locator('.ws-muted').first()).toHaveText('3 items');
    await expect(lineOf(page, 'Linen shirt').locator('.ws-line-opts')).toHaveText('Size: Small · Colour: White');
    await expect(lineOf(page, 'Desk lamp').locator('.ws-line-unit')).toHaveText('25,000 IQD / Piece');
    await expect(lineOf(page, 'Linen shirt').locator('.ws-line-total')).toHaveText('35,000 IQD');
    await expect(summaryRow(cartEl(page), 'Subtotal')).toHaveText('75,000 IQD');
    await expect(summaryRow(cartEl(page), 'Delivery fee')).toHaveText(money(fee));
    await expect(summaryRow(cartEl(page), 'Total')).toHaveText(money(75000 + fee));
    await expect(cartEl(page).getByRole('link', { name: 'Continue shopping' })).toHaveAttribute('href', '/products');

    // A second lamp: the line, the subtotal and the count follow, and the cart in the browser too.
    await lineOf(page, 'Desk lamp').getByRole('button', { name: 'Increase quantity' }).click();
    await expect(lineOf(page, 'Desk lamp').getByLabel('Quantity', { exact: true })).toHaveValue('2');
    await expect(lineOf(page, 'Desk lamp').locator('.ws-line-total')).toHaveText('50,000 IQD');
    await expect(summaryRow(cartEl(page), 'Subtotal')).toHaveText('100,000 IQD');
    await expect(cartBadge(page)).toHaveText('4');

    // Remove the hose.
    await lineOf(page, 'Garden hose').getByRole('button', { name: 'Remove Garden hose from cart' }).click();
    await expect(cartEl(page).locator('.ws-line .ws-line-name')).toHaveText(['Desk lamp', 'Linen shirt']);
    await expect(summaryRow(cartEl(page), 'Subtotal')).toHaveText('85,000 IQD');
    await expect(summaryRow(cartEl(page), 'Total')).toHaveText(money(85000 + fee));
    const kept = await readCart(page);
    expect(kept?.lines.map((l) => [l.item_id, l.quantity])).toEqual([[ITEM.lamp, 2], [ITEM.shirtSmallWhite, 1]]);

    // Checkout: the button leads to the page with the checkout role.
    await expect(cartEl(page).getByRole('link', { name: 'Checkout' })).toHaveAttribute('href', '/checkout');
    await cartEl(page).getByRole('link', { name: 'Checkout' }).click();
    await expect(page).toHaveURL('/checkout');
    const side = checkoutEl(page).locator('.ws-co-side');
    await expect(side.locator('.ws-mini .ws-mini-name')).toHaveText(['Desk lamp', 'Linen shirt']);
    await expect(side.locator('.ws-mini').first().locator('.ws-line-unit')).toHaveText('2 × 25,000 IQD / Piece');
    await expect(summaryRow(side, 'Total')).toHaveText(money(85000 + fee));
    await expect(placeOrder(page)).toHaveText(`Place order · ${money(85000 + fee)}`);
    await expect(checkoutEl(page).getByText('Cash on delivery')).toBeVisible();
    // The city is a select of the governorates in the page's language.
    const cities = await checkoutEl(page).getByLabel('City').locator('option').allTextContents();
    expect(cities).toHaveLength(1 + 19);
    expect(cities.slice(0, 3)).toEqual(['Choose a city', 'Baghdad', 'Basra']);

    await fillForm(page, { landmark: 'Opposite the pharmacy', notes: 'Call before noon' });
    await placeOrder(page).click();
    await expect(page).toHaveURL(/\/thanks\?order=[0-9a-f-]{36}$/);

    // One checkout was sent; its id is the one in the address, and the cart is over.
    expect(posted).toHaveLength(1);
    expect(new URL(page.url()).searchParams.get('order')).toBe(posted[0].checkout_id);
    expect(posted[0]).toMatchObject({ locale: 'en', buyer: { name: 'Ali Hassan Kadhim', phone: PHONE, city: 'baghdad', landmark: 'Opposite the pharmacy', notes: 'Call before noon' } });
    expect(posted[0].lines).toEqual([{ item_id: ITEM.lamp, quantity: '2' }, { item_id: ITEM.shirtSmallWhite, quantity: '1' }]);
    expect(await readCart(page)).toBeNull();

    // The confirmation: Sales's code, the lines with their options, the fee, the total, the cash-on-delivery note.
    const created = await ordersSince(salesBefore);
    expect(created).toHaveLength(1);
    const order = confirmationEl(page);
    await expect(order.getByRole('heading', { level: 1 })).toHaveText('Thank you, we’ve received your order');
    await expect(order.locator('[data-order-code]')).toHaveText(created[0].response.data.code);
    await expect(order.locator('[data-order-code]')).toHaveText(CODE);
    await expect(order.locator('.ws-conf-text')).toHaveText(`We’ll call you on ${PHONE} to confirm the delivery time.`);
    // The product's name above the options, as the handoff draws it. Sales names the variant's line "Linen shirt - Small / White";
    // the read gives the product's name apart (OPEN_QUESTIONS 47), so the options are not said twice.
    await expect(order.locator('.ws-mini .ws-mini-name')).toHaveText(['Desk lamp', 'Linen shirt']);
    await expect(order.locator('.ws-mini').nth(1).locator('.ws-line-opts')).toHaveText('Size: Small · Colour: White');
    await expect(order.locator('.ws-mini').first().locator('.ws-line-unit')).toHaveText('2 × 25,000 IQD / Piece');
    await expect(summaryRow(order, 'Subtotal')).toHaveText('85,000 IQD');
    await expect(summaryRow(order, 'Delivery fee')).toHaveText(money(fee));
    await expect(summaryRow(order, 'Total')).toHaveText(money(85000 + fee));
    await expect(order.locator('.ws-cod')).toContainText(`Have ${money(85000 + fee)} in cash ready to pay the courier on delivery.`);
    await expect(order.getByRole('link', { name: 'Back to shop' })).toHaveAttribute('href', '/products');
    await expect(cartBadge(page)).toHaveCount(0);

    // What Sales was asked for: the lines by item id (the variant's own), the fee, the address in the page's language, the checkout.
    expect(created[0].body).toMatchObject({
      source: 'storefront',
      sourceReference: site.id,
      checkoutId: posted[0].checkout_id,
      lines: [{ itemId: ITEM.lamp, quantity: '2' }, { itemId: ITEM.shirtSmallWhite, quantity: '1' }],
      deliveryFee: `${fee}.00`,
      deliveryAddress: { city: 'Baghdad', address: 'Karrada, district 903, alley 12, house 7', landmark: 'Opposite the pharmacy', phone: PHONE },
      notes: 'Call before noon',
    });
  } finally {
    await context.close();
  }
});

test('the phone field accepts a number with the country code, and says what it takes when it does not like one', async () => {
  const salesBefore = await calls('sales');
  const peopleBefore = await calls('contact-center');
  const context = await visitor();
  try {
    const page = await context.newPage();
    const posted = watchCheckouts(page);
    await addPlainItems(page, 'Desk lamp');
    await openCheckout(page);

    // Nothing filled but a short phone: three fields are refused, the alert lists them, each under its own field.
    await checkoutEl(page).getByLabel('Full name').fill('Ali Hassan Kadhim');
    await checkoutEl(page).getByLabel('Phone number').fill('12345');
    await placeOrder(page).click();
    const summary = alertOf(page, 'validation');
    await expect(summary).toBeVisible();
    await expect(summary.locator('.ws-alert-title')).toHaveText('Your order wasn’t sent. Fix 3 fields:');
    await expect(summary.getByRole('link')).toHaveText(['Phone number', 'City', 'Address']);
    const phoneField = checkoutEl(page).locator('.ws-field', { has: page.getByLabel('Phone number') });
    await expect(phoneField.locator('.ws-err')).toHaveText('Enter an Iraqi mobile number, such as 0770 123 4567 or +964 770 123 4567.');
    await expect(checkoutEl(page).getByLabel('Phone number')).toHaveAttribute('aria-invalid', 'true');
    await expect(checkoutEl(page).locator('.ws-field', { has: page.getByLabel('City') }).locator('.ws-err')).toHaveText('Choose your delivery city.');
    await expect(checkoutEl(page).locator('.ws-field', { has: page.getByLabel('Full name') }).locator('.ws-err')).toHaveCount(0);
    // Nothing was created, nobody was called, and the cart is as it was.
    expect(await attemptsSince(salesBefore)).toEqual([]);
    expect((await calls('contact-center')).length).toBe(peopleBefore.length);
    expect((await readCart(page))?.lines).toHaveLength(1);

    // The alert's link goes to the field.
    await summary.getByRole('link', { name: 'Phone number' }).click();
    await expect(checkoutEl(page).getByLabel('Phone number')).toBeFocused();

    // Correcting a field takes its message away; the number with the country code is a number.
    await checkoutEl(page).getByLabel('Phone number').fill(PHONE_WITH_CODE);
    await expect(phoneField.locator('.ws-err')).toHaveCount(0);
    await checkoutEl(page).getByLabel('City').selectOption({ label: 'Basra' });
    await checkoutEl(page).getByLabel('Address', { exact: true }).fill('Ashar, main road, house 4');
    await placeOrder(page).click();
    await expect(page).toHaveURL(/\/thanks\?order=/);
    expect(posted).toHaveLength(2);
    expect(posted[1].checkout_id, 'the refused try and the good one are one checkout').toBe(posted[0].checkout_id);

    const created = await ordersSince(salesBefore);
    expect(created).toHaveLength(1);
    const people = (await calls('contact-center')).slice(peopleBefore.length);
    expect(people[0].body).toMatchObject({ phone: `964771${DIGITS}` });
  } finally {
    await context.close();
  }
});

test('a name Contact Center would refuse is refused under the name field, in the page\'s language, and nobody is called (OPEN_QUESTIONS 37)', async () => {
  const salesBefore = await calls('sales');
  const peopleBefore = await calls('contact-center');
  const context = await visitor();
  try {
    const page = await context.newPage();
    await addPlainItems(page, 'Desk lamp');
    await openCheckout(page);
    const fullName = checkoutEl(page).getByLabel('Full name');
    const nameField = checkoutEl(page).locator('.ws-field', { has: page.getByLabel('Full name') });
    // Every other field is right; the first word is 101 characters, inside the name's 120 but over Contact Center's 100.
    await fullName.fill(`${'A'.repeat(101)} Ali`);
    await checkoutEl(page).getByLabel('Phone number').fill(PHONE);
    await checkoutEl(page).getByLabel('City').selectOption({ label: 'Basra' });
    await checkoutEl(page).getByLabel('Address', { exact: true }).fill('Ashar, main road, house 4');
    await placeOrder(page).click();
    await expect(alertOf(page, 'validation')).toBeVisible();
    await expect(nameField.locator('.ws-err')).toHaveText('Shorten the name: the first word and the rest can each be up to 100 characters.');
    await expect(fullName).toHaveAttribute('aria-invalid', 'true');
    expect(await attemptsSince(salesBefore)).toEqual([]);
    expect((await calls('contact-center')).length).toBe(peopleBefore.length);

    // Correcting the name takes the message away.
    await fullName.fill('Ali Hassan Kadhim');
    await expect(nameField.locator('.ws-err')).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test('an item that became unavailable at Place order is named with a Remove that drops it, and the order then goes through', async () => {
  const salesBefore = await calls('sales');
  const context = await visitor();
  try {
    const page = await context.newPage();
    const posted = watchCheckouts(page);
    await addPlainItems(page, 'Desk lamp', 'Garden hose');
    await openCheckout(page);
    await fillForm(page);

    // The hose is taken off sale after the page opened. (The fee changing with it is the store's: the page keeps the
    // one it read when it opened, and the order's own figures are on the confirmation.)
    const feeAtOpen = fee;
    await setItem(ITEM.hose, { status: 'INACTIVE' });
    await forgetCatalogue();
    await placeOrder(page).click();

    const banner = alertOf(page, 'items');
    await expect(banner.locator('.ws-alert-title')).toHaveText('An item is no longer available');
    await expect(banner.locator('.ws-alert-text')).toHaveText('“Garden hose” is no longer available. Remove it to place your order.');
    // Nothing is out of stock: the words say what the platform knows.
    await expect(checkoutEl(page)).not.toContainText(/stock/i);
    expect(await attemptsSince(salesBefore)).toEqual([]);
    // The line is marked and has its own Remove; Place order waits for it.
    const hose = checkoutEl(page).locator('.ws-co-side .ws-mini', { hasText: 'Garden hose' });
    await expect(hose.locator('.ws-tag')).toHaveText('Unavailable');
    await expect(placeOrder(page)).toBeDisabled();
    await expect(checkoutEl(page).getByText('Remove the unavailable item to place your order.')).toBeVisible();
    // The form keeps what the buyer typed.
    await expect(checkoutEl(page).getByLabel('Full name')).toHaveValue('Ali Hassan Kadhim');

    await banner.getByRole('button', { name: 'Remove item' }).click();
    await expect(banner).toHaveCount(0);
    await expect(checkoutEl(page).locator('.ws-co-side .ws-mini .ws-mini-name')).toHaveText(['Desk lamp']);
    expect((await readCart(page))?.lines.map((l) => l.item_id)).toEqual([ITEM.lamp]);
    await expect(placeOrder(page)).toBeEnabled();
    await expect(placeOrder(page)).toHaveText(`Place order · ${money(25000 + feeAtOpen)}`);

    await placeOrder(page).click();
    await expect(page).toHaveURL(/\/thanks\?order=/);
    expect(posted).toHaveLength(2);
    expect(posted[1].checkout_id).toBe(posted[0].checkout_id);
    expect(posted[1].lines).toEqual([{ item_id: ITEM.lamp, quantity: '1' }]);
    expect(await ordersSince(salesBefore)).toHaveLength(1);
  } finally {
    await setItem(ITEM.hose, { status: 'ACTIVE' });
    await forgetCatalogue();
    await context.close();
  }
});

test('with Sales down the buyer is told, the cart and the form are kept, a reload keeps the checkout, and trying again makes one order', async () => {
  const salesBefore = await calls('sales');
  const context = await visitor();
  try {
    const page = await context.newPage();
    const posted = watchCheckouts(page);
    await addPlainItems(page, 'Desk lamp');
    await openCheckout(page);
    await fillForm(page);

    await servicesDown(['sales']);
    await placeOrder(page).click();
    const banner = alertOf(page, 'service');
    await expect(banner.locator('.ws-alert-title')).toHaveText('We couldn’t send your order');
    await expect(banner.locator('.ws-alert-text')).toHaveText('The service is temporarily unavailable. Your cart and details are kept, so try again in a moment.');
    await expect(checkoutEl(page).getByLabel('Full name')).toHaveValue('Ali Hassan Kadhim');
    await expect(placeOrder(page)).toBeEnabled();
    expect(await ordersSince(salesBefore)).toEqual([]);
    expect((await attemptsSince(salesBefore)).every((call) => call.status === 503)).toBe(true);

    // The cart is kept, and so is its checkout.
    const afterFailure = await readCart(page);
    expect(afterFailure?.lines).toHaveLength(1);
    expect(afterFailure?.checkout_id).toBe(posted[0].checkout_id);

    // A reload on the checkout page: the cart and the checkout id are still there.
    await page.reload();
    await expect(placeOrder(page)).toBeVisible();
    await expect(placeOrder(page)).toContainText('IQD');
    await expect(checkoutEl(page).locator('.ws-co-side .ws-mini .ws-mini-name')).toHaveText(['Desk lamp']);
    const afterReload = await readCart(page);
    expect(afterReload?.checkout_id).toBe(afterFailure?.checkout_id);

    // Sales comes back: the same checkout goes through, once.
    await servicesDown([]);
    await fillForm(page);
    await placeOrder(page).click();
    await expect(page).toHaveURL(/\/thanks\?order=/);
    expect(posted).toHaveLength(2);
    expect(posted[1].checkout_id).toBe(posted[0].checkout_id);
    expect(new URL(page.url()).searchParams.get('order')).toBe(posted[0].checkout_id);
    expect(await ordersSince(salesBefore)).toHaveLength(1);
  } finally {
    await servicesDown([]);
    await context.close();
  }
});

test('"Try again" on the alert sends the same checkout', async () => {
  const salesBefore = await calls('sales');
  const context = await visitor();
  try {
    const page = await context.newPage();
    const posted = watchCheckouts(page);
    await addPlainItems(page, 'Garden hose');
    await openCheckout(page);
    await fillForm(page);
    await servicesDown(['sales']);
    await placeOrder(page).click();
    const banner = alertOf(page, 'service');
    await expect(banner).toBeVisible();
    await servicesDown([]);
    await banner.getByRole('button', { name: 'Try again' }).click();
    await expect(page).toHaveURL(/\/thanks\?order=/);
    expect(posted.map((p) => p.checkout_id)).toEqual([posted[0].checkout_id, posted[0].checkout_id]);
    expect(await ordersSince(salesBefore)).toHaveLength(1);
  } finally {
    await servicesDown([]);
    await context.close();
  }
});

test('a double click on Place order makes one request and one order', async () => {
  const salesBefore = await calls('sales');
  const context = await visitor();
  try {
    const page = await context.newPage();
    const posted = watchCheckouts(page);
    await addPlainItems(page, 'Desk lamp');
    await openCheckout(page);
    await fillForm(page);

    // Sales takes its time, so the first order is still on its way when the second click comes.
    await salesDelay(1200);
    await placeOrder(page).dblclick();
    await expect(checkoutEl(page).getByRole('button', { name: 'Placing your order…' })).toBeDisabled();
    await expect(checkoutEl(page).getByLabel('Full name')).toBeDisabled();
    await expect(page).toHaveURL(/\/thanks\?order=/);
    expect(posted).toHaveLength(1);
    expect(await attemptsSince(salesBefore)).toHaveLength(1);
    expect(await ordersSince(salesBefore)).toHaveLength(1);
    expect(await readCart(page)).toBeNull();
  } finally {
    await salesDelay(0);
    await context.close();
  }
});

test('a cart checked out in one tab is gone from another tab of the same browser, which shows the empty cart and makes no second order', async () => {
  const salesBefore = await calls('sales');
  const context = await visitor();
  try {
    const first = await context.newPage();
    await addPlainItems(first, 'Desk lamp');
    // A second tab of the same site shows the same cart.
    const second = await context.newPage();
    await openCheckout(second);
    await fillForm(second);
    await openCheckout(first);
    await fillForm(first);
    await placeOrder(first).click();
    await expect(first).toHaveURL(/\/thanks\?order=/);
    const code = await first.locator('[data-order-code]').textContent();
    // The second tab's cart was cleared by the first (the browser's storage event): it shows the empty cart, not a second order.
    await expect(checkoutEl(second).getByRole('heading', { name: 'Your cart is empty' })).toBeVisible();
    expect(await ordersSince(salesBefore)).toHaveLength(1);
    expect(code).toMatch(CODE);
  } finally {
    await context.close();
  }
});

test('the cart reads the catalogue when it opens: a new price replaces the old and says so, an item that has gone is marked and keeps Checkout off until it is removed', async () => {
  const context = await visitor();
  try {
    const page = await context.newPage();
    await addPlainItems(page, 'Desk lamp', 'Garden hose');
    await setItem(ITEM.lamp, { base_price: 27500 });
    await setItem(ITEM.hose, { status: 'INACTIVE' });
    await forgetCatalogue();

    await page.goto('/cart');
    const lamp = lineOf(page, 'Desk lamp');
    await expect(lamp.locator('.ws-line-unit')).toHaveText('27,500 IQD / Piece');
    await expect(lamp.locator('[data-line-state="price-updated"]')).toHaveText('Price updated · was 25,000 IQD');
    await expect(lamp.locator('.ws-line-total')).toHaveText('27,500 IQD');
    const hose = lineOf(page, 'Garden hose');
    await expect(hose.locator('[data-line-state="unavailable"]')).toHaveText('Unavailable');
    await expect(hose.getByRole('button', { name: /Increase quantity/ })).toHaveCount(0);
    // Checkout is a button that does nothing while a line cannot be bought, with the reason beside it.
    await expect(cartEl(page).getByRole('link', { name: 'Checkout' })).toHaveCount(0);
    await expect(cartEl(page).getByRole('button', { name: 'Checkout' })).toBeDisabled();
    await expect(cartEl(page).getByText('Remove the unavailable item to check out.')).toBeVisible();
    // The cart in the browser has the new price.
    expect((await readCart(page))?.lines.find((l) => l.item_id === ITEM.lamp)?.snapshot.price.amount).toBe('27500');

    await hose.getByRole('button', { name: 'Remove Garden hose from cart' }).click();
    await expect(cartEl(page).getByRole('link', { name: 'Checkout' })).toHaveAttribute('href', '/checkout');
    await expect(summaryRow(cartEl(page), 'Subtotal')).toHaveText('27,500 IQD');

    // The checkout page opens on the new price too, and has no mark for a price the cart already showed.
    await page.goto('/checkout');
    await expect(placeOrder(page)).toHaveText(`Place order · ${money(27500 + fee)}`);
  } finally {
    await setItem(ITEM.lamp, { base_price: 25000 });
    await setItem(ITEM.hose, { status: 'ACTIVE' });
    await forgetCatalogue();
    await context.close();
  }
});

test('an empty cart, an order address with no order, and an order of another site have their designed states', async () => {
  const context = await visitor();
  try {
    const page = await context.newPage();
    await page.goto('/cart');
    await expect(cartEl(page).getByRole('heading', { name: 'Your cart is empty' })).toBeVisible();
    await expect(cartEl(page).getByRole('link', { name: 'Browse products' })).toHaveAttribute('href', '/products');
    await expect(cartEl(page).getByRole('link', { name: 'Checkout' })).toHaveCount(0);

    await page.goto('/checkout');
    await expect(checkoutEl(page).getByRole('heading', { name: 'Your cart is empty' })).toBeVisible();
    await expect(checkoutEl(page).getByRole('link', { name: 'Back to cart' })).toHaveAttribute('href', '/cart');

    for (const address of ['/thanks', '/thanks?order=48484848-1111-4848-8848-484848484848', '/thanks?order=not-an-id']) {
      await page.goto(address);
      await expect(confirmationEl(page).getByRole('heading', { name: 'We can’t find this order' }), address).toBeVisible();
      await expect(confirmationEl(page).getByRole('link', { name: 'Back to shop' })).toHaveAttribute('href', '/products');
    }
  } finally {
    await context.close();
  }
});

test('the confirmation says so when Sales cannot be asked, and shows the order when it can again', async () => {
  const salesBefore = await calls('sales');
  const context = await visitor();
  try {
    const page = await context.newPage();
    await addPlainItems(page, 'Desk lamp');
    await openCheckout(page);
    await fillForm(page);
    await placeOrder(page).click();
    await expect(page).toHaveURL(/\/thanks\?order=/);
    const address = page.url();
    expect(await ordersSince(salesBefore)).toHaveLength(1);

    await servicesDown(['sales']);
    await page.goto(address);
    const alert = confirmationEl(page).getByRole('alert');
    await expect(alert).toContainText('We couldn’t load your order');
    await servicesDown([]);
    await alert.getByRole('button', { name: 'Try again' }).click();
    await expect(confirmationEl(page).locator('[data-order-code]')).toHaveText(CODE);
    // Reading the address again makes no second order.
    expect(await ordersSince(salesBefore)).toHaveLength(1);
  } finally {
    await servicesDown([]);
    await context.close();
  }
});

test('in Arabic the pages, the city names, the field errors and the confirmation speak Arabic and read right to left', async () => {
  const salesBefore = await calls('sales');
  const context = await visitor();
  try {
    const page = await context.newPage();
    const posted = watchCheckouts(page);
    await page.goto('/ar/products');
    await expect(page.locator('[data-ws-store="productGrid"] article.ws-card').first()).toBeVisible();
    await addFromGrid(page, 'مصباح مكتب');
    await expect(page.getByRole('link', { name: 'السلة: 1 قطعة' })).toHaveAttribute('href', '/ar/cart');
    await page.getByRole('link', { name: 'السلة: 1 قطعة' }).click();
    await expect(page).toHaveURL('/ar/cart');

    await expect(cartEl(page)).toHaveAttribute('dir', 'rtl');
    await expect(cartEl(page).getByRole('heading', { level: 1 })).toHaveText('سلة التسوق');
    // The count after the number is the invariant singular, also for one (OPEN_QUESTIONS 51).
    await expect(cartEl(page).locator('.ws-muted').first()).toHaveText('1 قطعة');
    await expect(lineOf(page, 'مصباح مكتب').locator('.ws-line-unit')).toHaveText('25,000 د.ع / Piece');
    await expect(summaryRow(cartEl(page), 'المجموع الفرعي')).toHaveText('25,000 د.ع');
    await expect(summaryRow(cartEl(page), 'رسوم التوصيل')).toHaveText(`${fee.toLocaleString('en-US')} د.ع`);
    await cartEl(page).getByRole('link', { name: 'إتمام الطلب' }).click();
    await expect(page).toHaveURL('/ar/checkout');
    await expect(placeOrder(page)).toBeVisible();
    await expect(placeOrder(page)).toContainText('د.ع');

    const cities = await checkoutEl(page).getByLabel('المدينة').locator('option').allTextContents();
    expect(cities.slice(0, 4)).toEqual(['اختر المدينة', 'بغداد', 'البصرة', 'نينوى']);
    expect(cities).toHaveLength(20);

    // The route's own words, in Arabic, under the fields.
    await checkoutEl(page).getByLabel('رقم الهاتف').fill('123');
    await placeOrder(page).click();
    await expect(alertOf(page, 'validation').locator('.ws-alert-title')).toHaveText('لم يُرسَل الطلب. صحّح 4 حقول:');
    await expect(checkoutEl(page).locator('.ws-field', { has: page.getByLabel('الاسم الكامل') }).locator('.ws-err')).toHaveText('أدخل اسمك الكامل.');
    await expect(checkoutEl(page).locator('.ws-field', { has: page.getByLabel('رقم الهاتف') }).locator('.ws-err')).toContainText('أدخل رقم هاتف محمول عراقي');

    // A first word over Contact Center's 100 characters is refused under the name, in Arabic too.
    await checkoutEl(page).getByLabel('الاسم الكامل').fill(`${'ب'.repeat(101)} علي`);
    await placeOrder(page).click();
    await expect(checkoutEl(page).locator('.ws-field', { has: page.getByLabel('الاسم الكامل') }).locator('.ws-err'))
      .toHaveText('اختصر الاسم: لا تزيد الكلمة الأولى ولا بقية الاسم على 100 حرف.');

    await checkoutEl(page).getByLabel('الاسم الكامل').fill('علي حسن كاظم');
    await checkoutEl(page).getByLabel('رقم الهاتف').fill(PHONE);
    await checkoutEl(page).getByLabel('المدينة').selectOption({ label: 'بغداد' });
    await checkoutEl(page).getByLabel('العنوان', { exact: true }).fill('الكرادة، محلة 903، زقاق 12، دار 7');
    await placeOrder(page).click();
    await expect(page).toHaveURL(/\/ar\/thanks\?order=/);
    expect(posted.at(-1)).toMatchObject({ locale: 'ar', buyer: { city: 'baghdad' } });

    const order = confirmationEl(page);
    await expect(order).toHaveAttribute('dir', 'rtl');
    await expect(order.getByRole('heading', { level: 1 })).toHaveText('شكرًا لك، تم استلام طلبك');
    await expect(order.locator('[data-order-code]')).toHaveText(CODE);
    await expect(order.locator('.ws-conf-text')).toContainText('سنتصل بك على');
    await expect(order.locator('.ws-mini-name')).toHaveText(['مصباح مكتب']);
    await expect(order.locator('.ws-cod')).toContainText('جهّز مبلغ');
    await expect(order.getByRole('link', { name: 'العودة إلى المتجر' })).toHaveAttribute('href', '/ar/products');

    // Sales has the governorate by its Arabic name, as the buyer chose it.
    const created = await ordersSince(salesBefore);
    expect(created).toHaveLength(1);
    expect(created[0].body?.deliveryAddress).toMatchObject({ city: 'بغداد' });
  } finally {
    await context.close();
  }
});

test('on a phone the order summary is a collapsed bar that opens, and the page has no sideways scroll', async () => {
  const context = await visitor({ viewport: { width: 390, height: 844 } });
  try {
    const page = await context.newPage();
    await addPlainItems(page, 'Desk lamp');
    await openCheckout(page);
    const bar = checkoutEl(page).locator('.ws-co-phone');
    await expect(bar).toBeVisible();
    await expect(checkoutEl(page).locator('.ws-co-side')).toBeHidden();
    await expect(bar.locator('summary')).toContainText(money(25000 + fee));
    await expect(bar.locator('summary')).toContainText('· 1 item');
    expect(await bar.evaluate((el) => (el as HTMLDetailsElement).open)).toBe(false);
    await bar.locator('summary').click();
    expect(await bar.evaluate((el) => (el as HTMLDetailsElement).open)).toBe(true);
    await expect(bar.locator('.ws-mini-name')).toHaveText(['Desk lamp']);
    await expect(summaryRow(bar, 'Total')).toHaveText(money(25000 + fee));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    await page.goto('/cart');
    await expect(lineOf(page, 'Desk lamp')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  } finally {
    await context.close();
  }
});

/** How far the page reaches past the window's width, in pixels: 0 when it has no sideways scroll. */
const sidewaysScroll = (page: Page) => page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - window.innerWidth));

test('in Arabic the cart and the checkout have no sideways scroll either, on a phone and on a desktop', async () => {
  // A right to left page scrolls towards the left: anything placed far off to the left (the form's decoy field) widens it.
  for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 900 }]) {
    const context = await visitor({ viewport });
    try {
      const page = await context.newPage();
      await page.goto('/ar/products');
      await expect(page.locator('[data-ws-store="productGrid"] article.ws-card').first()).toBeVisible();
      await addFromGrid(page, 'مصباح مكتب');
      await expect(cartBadge(page)).toHaveText('1');

      await page.goto('/ar/cart');
      await expect(lineOf(page, 'مصباح مكتب')).toBeVisible();
      expect(await sidewaysScroll(page), `the cart at ${viewport.width} px`).toBe(0);

      await page.goto('/ar/checkout');
      await expect(placeOrder(page)).toContainText('د.ع');
      expect(await sidewaysScroll(page), `the checkout at ${viewport.width} px`).toBe(0);
    } finally {
      await context.close();
    }
  }
});

test('the checkout form still carries the decoy field in its box: a bot that fills it is sent, and no order is made', async () => {
  const salesBefore = await calls('sales');
  const context = await visitor();
  try {
    const page = await context.newPage();
    const posted = watchCheckouts(page);
    await addPlainItems(page, 'Desk lamp');
    await openCheckout(page);
    const decoy = checkoutEl(page).locator(`form .ws-decoy input[name="${HONEYPOT_FIELD_NAME}"]`);
    await expect(decoy).toHaveCount(1);
    await decoy.fill('a bot was here', { force: true });
    await fillForm(page);
    await placeOrder(page).click();
    await expect(alertOf(page, 'service')).toBeVisible();
    expect(posted.at(-1)).toMatchObject({ [HONEYPOT_FIELD_NAME]: 'a bot was here' });
    expect(await attemptsSince(salesBefore)).toHaveLength(0);
  } finally {
    await context.close();
  }
});

test('motion: the spinner turns and the banners rise, and under reduced motion the spinner stops and the banners only fade', async () => {
  for (const reducedMotion of ['no-preference', 'reduce'] as const) {
    const context = await visitor({ reducedMotion });
    try {
      const page = await context.newPage();
      await addPlainItems(page, 'Garden hose');
      await openCheckout(page);
      await fillForm(page);
      await servicesDown(['sales']);
      await salesDelay(1500);
      await placeOrder(page).click();
      const spinner = checkoutEl(page).locator('.ws-spinner');
      await expect(spinner).toBeVisible();
      const spinning = await spinner.evaluate((el) => getComputedStyle(el).animationName);
      expect(spinning, reducedMotion).toBe(reducedMotion === 'reduce' ? 'none' : 'ws-spin');

      const banner = alertOf(page, 'service');
      await expect(banner).toBeVisible({ timeout: 10_000 });
      const arrival = await banner.evaluate((el) => getComputedStyle(el).animationName);
      expect(arrival, reducedMotion).toBe(reducedMotion === 'reduce' ? 'ws-fade-in' : 'ws-notice-in');
      // Place order presses in only where motion is welcome.
      const press = await placeOrder(page).evaluate((el) => getComputedStyle(el).transitionProperty);
      expect(press.includes('transform'), reducedMotion).toBe(reducedMotion !== 'reduce');
    } finally {
      await servicesDown([]);
      await salesDelay(0);
      await context.close();
    }
  }
});

test('a store that does not sell answers its cart, checkout and confirmation pages with the site\'s not-found page, and its elements draw nothing', async () => {
  // A site of its own that has never sold: its pages are not in any cache, so the first answer is the real one.
  const other = await signIn(baseURL, { ...OWNER, sub: '7a7a7a7a-7a7a-4a7a-8a7a-7a7a7a7a7a7a', email: 'owner-checkout-flow-off@example.com' });
  const offSlug = `cf-off-${RUN}`;
  const off = await createSite(other, { name: 'Closed Store', slug: offSlug, languages: ['en'], default_language: 'en' });
  try {
    expect((await openSite(other, off.id)).status()).toBe(303);
    await putLayersFor(other, await createPage(other, 'cart', { store: { kind: 'cart' } }), body(indicator('i1'), element('cart', 'cart')));
    await putLayersFor(other, await createPage(other, 'checkout', { store: { kind: 'checkout' } }), body(element('checkout', 'checkout')));
    await putLayersFor(other, await createPage(other, 'thanks', { store: { kind: 'confirmation' } }), body(element('conf', 'orderConfirmation')));
    await putLayersFor(other, await createPage(other, 'about'), body(element('about-cart', 'cart')));
    await publish(other);

    const context = await browser.newContext({ baseURL: `http://${offSlug}.${TEST_SITES_DOMAIN}:${PORT}` });
    try {
      const page = await context.newPage();
      for (const address of ['/cart', '/checkout', '/thanks']) {
        const response = await page.goto(address);
        expect(response?.status(), address).toBe(404);
        await expect(page.locator('[data-ws-store="cart"], [data-ws-store="checkout"], [data-ws-store="orderConfirmation"]'), address).toHaveCount(0);
      }
      // A cart element on an ordinary page of a store that does not sell renders nothing.
      const about = await page.goto('/about');
      expect(about?.status()).toBe(200);
      await page.waitForLoadState('networkidle');
      await expect(page.locator('[data-ws-store="cart"] .ws-cart-page, [data-ws-store="cart"] .ws-empty')).toHaveCount(0);
    } finally {
      await context.close();
    }
  } finally {
    await other.delete(`/ycode/api/platform/sites/${off.id}`);
    await other.dispose();
  }
});

async function putLayersFor(api: APIRequestContext, pageId: string, layers: unknown[]): Promise<void> {
  const response = await api.put(`/ycode/api/layers?page_id=${pageId}`, { data: { layers } });
  expect(response.status(), await response.text()).toBe(200);
}

// ---------------------------------------------------------------------------
// The builder
// ---------------------------------------------------------------------------

test('the Store category lists the cart, checkout and confirmation elements, and the Layouts tab their sections with previews', async () => {
  const context = await browser.newContext({ baseURL, storageState: await owner.storageState(), viewport: { width: 1600, height: 1000 } });
  try {
    const page = await context.newPage();
    await page.goto(`/ycode/api/platform/sites/${site.id}/open`);
    await expect(page.getByRole('tab', { name: 'Pages' })).toBeVisible({ timeout: 60_000 });
    await page.getByRole('tab', { name: 'Layers' }).click();
    await page.getByRole('tabpanel', { name: 'Layers' }).getByText('Layers', { exact: true }).locator('xpath=following::button[1]').click();
    const elements = page.getByRole('tabpanel', { name: 'Elements' });
    for (const name of ['Cart', 'Checkout', 'Order confirmation', 'Cart indicator']) await expect(elements.getByText(name, { exact: true })).toBeVisible();

    await page.getByRole('tab', { name: 'Layouts' }).click();
    const layouts = page.getByRole('tabpanel', { name: 'Layouts' });
    await layouts.getByText('Store', { exact: true }).click();
    for (const preview of ['store-cart-page', 'store-checkout-page', 'store-order-confirmation']) {
      const image = layouts.locator(`img[src*="${preview}"]`);
      await expect(image).toBeVisible();
      await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0), preview).toBe(true);
    }
  } finally {
    await context.close();
  }
});

test('the builder canvas draws the cart, checkout and confirmation with sample data and never asks the store API', async () => {
  const samples = await createPage(owner, `samples-${RUN}`);
  await putLayers(samples, body(element('s-cart', 'cart'), element('s-checkout', 'checkout'), element('s-conf', 'orderConfirmation')));
  const context = await browser.newContext({ baseURL, storageState: await owner.storageState(), viewport: { width: 1600, height: 1000 } });
  try {
    const page = await context.newPage();
    const storeCalls: string[] = [];
    page.on('request', (req) => {
      const { pathname } = new URL(req.url());
      if (/^\/(?:ycode|studio)\/api\/store\/(products|categories|settings|checkout|orders)/.test(pathname) || pathname.startsWith('/store-media/')) storeCalls.push(`${req.method()} ${pathname}`);
    });
    await page.goto(`/ycode/api/platform/sites/${site.id}/open`);
    await expect(page.getByRole('tab', { name: 'Pages' })).toBeVisible({ timeout: 60_000 });
    await page.getByRole('tab', { name: 'Pages' }).click();
    await page.getByText(`samples-${RUN}`, { exact: true }).first().click();

    const canvas = page.frameLocator('iframe').first();
    const cart = canvas.locator('[data-ws-store="cart"]');
    await expect(cart.locator('.ws-line .ws-line-name')).toHaveText(['Cotton T-shirt', 'Wool hoodie', 'Canvas tote bag'], { timeout: 60_000 });
    await expect(summaryRow(cart, 'Total')).toHaveText('115,000 IQD');
    await expect(cart.locator('.ws-line').first().locator('.ws-line-opts')).toHaveText('Colour: Black · Size: M');
    const checkout = canvas.locator('[data-ws-store="checkout"]');
    await expect(checkout.getByText('Delivery details')).toBeVisible();
    await expect(checkout.getByRole('button', { name: 'Place order · 115,000 IQD' })).toBeVisible();
    const confirmation = canvas.locator('[data-ws-store="orderConfirmation"]');
    await expect(confirmation.locator('[data-order-code]')).toHaveText('SO-2026-0142');
    // The sample has no network behind it, and a click on it selects the layer like any other.
    await cart.click({ position: { x: 4, y: 4 } });
    await page.getByRole('tab', { name: 'Settings' }).click();
    await page.waitForTimeout(1500);
    expect(storeCalls, 'the canvas never calls the store API or asks for a product image').toEqual([]);
  } finally {
    await context.close();
  }
});

test('the static export carries each element\'s shell, and no error', async () => {
  const out = await fs.mkdtemp(path.join(os.tmpdir(), 'ws-checkout-export-'));
  try {
    const settings = await owner.put('/ycode/api/apps/static-export/settings', { data: {
      outputTargets: ['local'],
      localPath: out,
      s3Bucket: '',
      s3Region: '',
      s3AccessKey: '',
      s3SecretKey: '',
      githubRepo: '',
      githubBranch: 'main',
      githubToken: '',
      githubAuthorName: '',
      githubAuthorEmail: '',
    } });
    expect(settings.status(), await settings.text()).toBe(200);
    const started = await owner.post('/ycode/api/apps/static-export/export');
    expect(started.status(), await started.text()).toBe(200);
    let job: { status: string; error: string | null } | null = null;
    await expect.poll(async () => {
      job = (await (await owner.get('/ycode/api/apps/static-export/status')).json()).data;
      return job?.status;
    }, { timeout: 60_000 }).not.toBe('running');
    expect(job, 'the export finished').toMatchObject({ status: 'completed', error: null });

    const files = (await fs.readdir(out, { recursive: true })).filter((file) => file.endsWith('.html'));
    const html = (await Promise.all(files.map((file) => fs.readFile(path.join(out, file), 'utf8')))).join('\n');
    for (const [name, loading] of [['cart', 'Loading your cart…'], ['checkout', 'Loading the checkout…'], ['orderConfirmation', 'Loading your order…']]) {
      expect(html, name).toContain(`data-ws-store="${name}"`);
      expect(html, name).toContain(`role="status">${loading}`);
    }
    expect(html).not.toContain('googleapis');
  } finally {
    await fs.rm(out, { recursive: true, force: true });
  }
});
