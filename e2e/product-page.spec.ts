/**
 * Part 2, session W5 "done when": the product page and the buyer's cart. A page
 * with the product role publishes; /products/{id} shows the item with the
 * picker (the unavailable options disabled) and the right price per variant;
 * picking and adding puts the variant's id in the cart in the browser, and the
 * cart indicator shows the count after a reload; an item that is not on sale
 * shows the "no longer available" state with a 404; a plain item adds from its
 * card without the page.
 *
 * The catalogue organization of e2e/platform-fixtures.ts, as catalogue.spec.ts
 * and store-elements.spec.ts have it. The linen shirt has four variants: Small
 * White (35,000 IQD), Small Blue (20 USD, 30,400 IQD at the stub's rate of
 * 1520), Medium White (discontinued) and Large White (no price), so Medium and
 * Large cannot be bought and the page opens on Small Blue, the cheapest.
 *
 * The product page is cached per item for 60 seconds (owner, W5 grill-me), so
 * each scenario that changes what the catalogue says uses an item no other
 * scenario asks for.
 */

import { expect, request, test, type APIRequestContext, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { createSite, draftPages, openSite, publish, publishedSite, signIn, TEST_SITES_DOMAIN, type SiteRecord } from './helpers';
import { BRANCH, CATALOGUE_ORG, CATEGORY, ITEM } from './platform-fixtures';

test.describe.configure({ mode: 'serial' });

const RUN = Date.now().toString(36);
const PORT = Number(process.env.E2E_PORT || 3102);
const PLATFORM = `http://127.0.0.1:${Number(process.env.E2E_PLATFORM_PORT || PORT + 3)}`;
const SLUG = `pp-${RUN}`;
const HOST = `${SLUG}.${TEST_SITES_DOMAIN}`;
const OWNER = { sub: '77777777-7777-4777-8777-777777777777', email: 'owner-product@example.com', name: 'Product Owner', org: CATALOGUE_ORG };

let baseURL: string;
let owner: APIRequestContext;
let site: SiteRecord;
let fee = 5000;

const NOT_AN_ITEM = '48484848-9999-4848-8848-484848484848';
const UNKNOWN_WHILE_DOWN = '48484848-7777-4848-8848-484848484848';

const detail = (id: string, product?: { id: string; name: string; name_ar: string | null }) => ({
  id,
  name: 'productDetail',
  classes: 'w-full',
  settings: { tag: 'div', store: { productDetail: { product: product ?? null } } },
  children: [],
});
const card = (id: string, product: { id: string; name: string; name_ar: string | null }) => ({
  id,
  name: 'productCard',
  classes: 'w-full',
  settings: { tag: 'div', store: { productCard: { product } } },
  children: [],
});
const grid = (id: string) => ({ id, name: 'productGrid', classes: 'w-full', settings: { tag: 'div', store: { productGrid: {} } }, children: [] });
const indicator = (id: string) => ({ id, name: 'cartIndicator', classes: 'w-fit', settings: { tag: 'div' }, children: [] });
const body = (...children: unknown[]) => [{ id: 'body', name: 'body', classes: '', children }];

async function control(url: string, data: unknown): Promise<void> {
  const context = await request.newContext();
  try {
    expect((await context.post(url, { data })).status()).toBe(200);
  } finally {
    await context.dispose();
  }
}

async function patchStore(data: Record<string, unknown>): Promise<void> {
  const response = await owner.patch(`/ycode/api/platform/sites/${site.id}/store`, { data });
  expect(response.status(), await response.text()).toBe(200);
}
/** Any change to the store settings makes the next store read ask the stubs again (catalogue.spec.ts). */
const forgetCatalogue = () => patchStore({ delivery_fee: (fee += 250) });
const CATEGORIES = [CATEGORY.clothing, CATEGORY.home, CATEGORY.toys];

async function putLayers(pageId: string, layers: unknown[]): Promise<void> {
  const response = await owner.put(`/ycode/api/layers?page_id=${pageId}`, { data: { layers } });
  expect(response.status(), await response.text()).toBe(200);
}

async function createPage(slug: string, settings: Record<string, unknown> = {}): Promise<string> {
  const response = await owner.post('/ycode/api/pages', { data: { name: slug, slug, settings } });
  expect(response.status() < 300, await response.text()).toBe(true);
  return (await response.json()).data.id as string;
}

async function visitor(browser: Browser, options: { lang?: string; reducedMotion?: 'reduce' | 'no-preference' } = {}): Promise<BrowserContext> {
  return browser.newContext({ baseURL, extraHTTPHeaders: { 'x-forwarded-host': HOST }, locale: options.lang, reducedMotion: options.reducedMotion });
}

const CART_KEY = () => `ws-cart:${site.id}`;
/** The cart in the browser: what localStorage holds under the site's key. */
const readCart = (page: Page) =>
  page.evaluate((key) => JSON.parse(window.localStorage.getItem(key) ?? 'null') as { version: number; lines: Array<{ item_id: string; product_id: string; quantity: number; snapshot: Record<string, unknown> }> } | null, CART_KEY());

/**
 * Opens a product page and waits for the browser to have read the item again: the page is server-rendered, so
 * its buttons are there before the script is, and a click before then would be lost. The read is sent from the
 * element's first effect, which is when the page is live.
 */
async function openProduct(page: Page, path: string) {
  const [, response] = await Promise.all([
    page.waitForResponse((r) => /\/studio\/api\/store\/products\/[^/?]+$/.test(new URL(r.url()).pathname)),
    page.goto(path),
  ]);
  return response;
}

const detailOf = (page: Page) => page.locator('[data-ws-store="productDetail"]').first();
const priceOf = (page: Page) => detailOf(page).locator('.ws-pd-price');
const optionRow = (page: Page, axis: string) => detailOf(page).locator('fieldset', { has: page.locator('legend', { hasText: axis }) });
const badge = (page: Page) => page.locator('[data-ws-store="cartIndicator"] .ws-badge');

test.beforeAll(async ({ baseURL: configured }) => {
  baseURL = configured!;
  await control(`${PLATFORM}/__down`, { services: [] });
  await control(`${PLATFORM}/__rate`, { found: true });
  owner = await signIn(baseURL, OWNER);
  site = await createSite(owner, { name: 'Product Store', slug: SLUG, languages: ['en', 'ar'], default_language: 'en' });
  expect(site.hosts[0]).toBe(HOST);
  expect((await openSite(owner, site.id)).status()).toBe(303);
  await patchStore({ branch_id: BRANCH.catalogue, category_ids: CATEGORIES, delivery_fee: fee, selling: true });

  const home = (await draftPages(owner)).find((page) => page.is_index)!;
  await putLayers(home.id, body(
    indicator('cart'),
    grid('grid'),
    card('lamp-card', { id: ITEM.lamp, name: 'Desk lamp', name_ar: 'مصباح مكتب' }),
  ));
  // The page with the product role: its own address is /products, the item's id follows.
  const productPage = await createPage('products', { store: { kind: 'product' } });
  await putLayers(productPage, body(indicator('cart-on-product'), detail('detail')));
  // Any other page can show one chosen product.
  await putLayers(await createPage('landing'), body(indicator('cart-on-landing'), detail('chosen', { id: ITEM.lamp, name: 'Desk lamp', name_ar: 'مصباح مكتب' })));
  await publish(owner);
});

test.afterAll(async () => {
  await control(`${PLATFORM}/__down`, { services: [] });
  await control(`${PLATFORM}/__rate`, { found: true });
  if (site) await owner.delete(`/ycode/api/platform/sites/${site.id}`);
  await owner?.dispose();
});

test('a publish writes where the product page lives, in each language, for the store elements to link to', async () => {
  const response = await owner.get('/ycode/api/settings/store_pages');
  expect(response.status(), await response.text()).toBe(200);
  expect((await response.json()).data).toEqual({ product: { '*': '/products', ar: '/ar/products' } });
});

test('the grid\'s "Choose options" leads to the page with the product role, in the card\'s language', async ({ browser }) => {
  const context = await visitor(browser);
  try {
    const page = await context.newPage();
    await page.goto('/');
    const shirt = page.locator('[data-ws-store="productGrid"] article', { hasText: 'Linen shirt' });
    await expect(shirt.getByRole('link', { name: 'Choose options' })).toHaveAttribute('href', `/products/${ITEM.shirt}`);
    await page.goto('/ar');
    const arabic = page.locator('[data-ws-store="productGrid"] article', { hasText: 'قميص كتان' });
    await expect(arabic.getByRole('link', { name: 'اختر الخيارات' })).toHaveAttribute('href', `/ar/products/${ITEM.shirt}`);
  } finally {
    await context.close();
  }
});

test('/products/{parent id} shows the item with its picker: Medium and Large cannot be bought and say so, and each variant has its own price', async ({ browser }) => {
  const context = await visitor(browser);
  try {
    const page = await context.newPage();
    const response = await page.goto(`/products/${ITEM.shirt}`);
    expect(response?.status()).toBe(200);
    await expect(detailOf(page).getByRole('heading', { level: 1 })).toHaveText('Linen shirt');
    await expect(detailOf(page).locator('.ws-sku')).toHaveText('SKU: SHT-001-S-BLU');
    await page.waitForLoadState('networkidle');
    // It opens on the cheapest variant that can be bought: Small Blue, 20 USD at 1520.
    await expect(priceOf(page)).toContainText('30,400 IQD');
    await expect(priceOf(page).locator('.ws-pd-unit')).toHaveText('/ pcs');
    await expect(detailOf(page).locator('.ws-desc')).toHaveText('Washed linen.');
    await expect(detailOf(page).locator('img').first()).toHaveAttribute('src', new RegExp(`/store-media/.+item=${ITEM.shirt}`));

    const size = optionRow(page, 'Size');
    const colour = optionRow(page, 'Colour');
    await expect(size.locator('.ws-legend-val')).toHaveText('Small');
    await expect(colour.locator('.ws-legend-val')).toHaveText('Blue');
    await expect(size.getByRole('button')).toHaveText(['Small', 'Medium · unavailable', 'Large · unavailable']);
    await expect(colour.getByRole('button')).toHaveText(['White', 'Blue']);
    await expect(size.getByRole('button', { name: /Medium/ })).toBeDisabled();
    await expect(size.getByRole('button', { name: /Large/ })).toBeDisabled();
    await expect(size.getByRole('button', { name: 'Small' })).toHaveAttribute('aria-pressed', 'true');
    await expect(colour.getByRole('button', { name: 'Blue' })).toHaveAttribute('aria-pressed', 'true');

    // White is Small White: another SKU, another price.
    await colour.getByRole('button', { name: 'White' }).click();
    await expect(priceOf(page)).toContainText('35,000 IQD');
    await expect(detailOf(page).locator('.ws-sku')).toHaveText('SKU: SHT-001-S-WHT');
    await expect(colour.locator('.ws-legend-val')).toHaveText('White');
    await colour.getByRole('button', { name: 'Blue' }).click();
    await expect(priceOf(page)).toContainText('30,400 IQD');

    // A disabled option cannot be clicked into.
    await size.getByRole('button', { name: /Medium/ }).click({ force: true });
    await expect(size.locator('.ws-legend-val')).toHaveText('Small');
  } finally {
    await context.close();
  }
});

test('the server sends the product in the page itself: the name, the SKU, the price and the picker are markup before any script runs', async () => {
  const anonymous = await publishedSite(baseURL, HOST);
  try {
    const response = await anonymous.get(`/products/${ITEM.shirt}`);
    expect(response.status()).toBe(200);
    const html = await response.text();
    expect(html).toMatch(/<h1 class="ws-pd-title">Linen shirt<\/h1>/);
    expect(html).toContain('SHT-001-S-BLU</span>');
    expect(html).toMatch(/<p class="ws-pd-price">[^]*30,400/);
    expect(html).toContain('class="ws-opt ws-opt-off"');
  } finally {
    await anonymous.dispose();
  }
});

test('picking a variant and adding it puts the variant\'s id in the cart; the notice names it; the indicator counts it, also after a reload', async ({ browser }) => {
  const context = await visitor(browser);
  try {
    const page = await context.newPage();
    await openProduct(page, `/products/${ITEM.shirt}`);
    await expect(badge(page)).toHaveCount(0);
    await optionRow(page, 'Colour').getByRole('button', { name: 'White' }).click();
    await detailOf(page).getByRole('button', { name: 'Increase quantity' }).click();
    await expect(detailOf(page).getByRole('textbox', { name: 'Quantity' })).toHaveValue('2');
    await detailOf(page).getByRole('button', { name: 'Add to cart' }).click();

    const notice = detailOf(page).getByRole('status');
    await expect(notice).toContainText('Linen shirt (Small, White) added to your cart.');
    await expect(notice.getByRole('link', { name: 'View cart' })).toHaveAttribute('href', '#');
    await expect(badge(page)).toHaveText('2');

    const cart = await readCart(page);
    expect(cart?.version).toBe(1);
    expect(cart?.lines).toHaveLength(1);
    expect(cart?.lines[0]).toMatchObject({
      item_id: ITEM.shirtSmallWhite,
      product_id: ITEM.shirt,
      quantity: 2,
      snapshot: {
        name: 'Linen shirt',
        name_ar: 'قميص كتان',
        price: { amount: '35000', currency: 'IQD' },
        unit: { name: 'Piece', symbol: 'pcs' },
        axes: [
          { name: 'Size', name_ar: 'المقاس', option: 'Small', option_ar: 'صغير' },
          { name: 'Colour', name_ar: 'اللون', option: 'White', option_ar: 'أبيض' },
        ],
      },
    });

    // Adding the same variant again merges into its line.
    await detailOf(page).getByRole('button', { name: 'Add to cart' }).click();
    await expect(badge(page)).toHaveText('4');
    expect((await readCart(page))?.lines).toHaveLength(1);

    // Another variant is another line.
    await optionRow(page, 'Colour').getByRole('button', { name: 'Blue' }).click();
    await detailOf(page).getByRole('textbox', { name: 'Quantity' }).fill('1');
    await detailOf(page).getByRole('button', { name: 'Add to cart' }).click();
    await expect(badge(page)).toHaveText('5');
    expect((await readCart(page))?.lines.map((line) => [line.item_id, line.quantity])).toEqual([[ITEM.shirtSmallWhite, 4], [ITEM.shirtSmallBlue, 1]]);

    // The cart survives a reload, on this page and on another.
    await page.reload();
    await expect(badge(page)).toHaveText('5');
    await page.goto('/');
    await expect(badge(page)).toHaveText('5');
  } finally {
    await context.close();
  }
});

test('a plain item adds from its card without the product page, and the card says so when the cart is full', async ({ browser }) => {
  const context = await visitor(browser);
  try {
    const page = await context.newPage();
    await page.goto('/');
    const lamp = page.locator('[data-ws-store="productCard"]');
    await expect(lamp.locator('.ws-card-name')).toHaveText('Desk lamp');
    await expect(page.locator('[data-ws-store="productGrid"] article')).toHaveCount(2);
    await lamp.getByRole('button', { name: 'Add to cart' }).click();
    await expect(badge(page)).toHaveText('1');
    expect(page.url()).toBe(`${baseURL}/`);
    const cart = await readCart(page);
    expect(cart?.lines[0]).toMatchObject({ item_id: ITEM.lamp, product_id: ITEM.lamp, quantity: 1, snapshot: { name: 'Desk lamp', axes: [], price: { amount: '25000', currency: 'IQD' }, unit: { symbol: 'pcs' } } });

    // A grid card does the same.
    await page.locator('[data-ws-store="productGrid"] article', { hasText: 'Desk lamp' }).getByRole('button', { name: 'Add to cart' }).click();
    await expect(badge(page)).toHaveText('2');
    expect((await readCart(page))?.lines).toHaveLength(1);

    // The cart holds as many different items as a checkout takes (50): the fifty-first is refused, in words.
    await page.evaluate((key) => {
      const line = (n: number) => ({
        item_id: `filler-${n}`, product_id: `filler-${n}`, quantity: 1,
        snapshot: { name: `Filler ${n}`, name_ar: null, axes: [], price: { amount: '1000', currency: 'IQD' }, image: null, unit: null },
      });
      window.localStorage.setItem(key, JSON.stringify({ version: 1, lines: Array.from({ length: 50 }, (_, i) => line(i)) }));
    }, CART_KEY());
    await page.reload();
    await expect(badge(page)).toHaveText('50');
    await lamp.getByRole('button', { name: 'Add to cart' }).click();
    await expect(lamp.getByRole('status')).toContainText('Your cart is full');
    await expect(badge(page)).toHaveText('50');
  } finally {
    await context.close();
  }
});

test('an item that is not on sale answers 404 and shows the page\'s "no longer available" state, and so does an address with no item', async ({ browser }) => {
  // Not an item at all, inactive, priced 0, a variant's own id (never a product), and something that is not an id.
  const gone = [NOT_AN_ITEM, ITEM.oldLamp, ITEM.sample, ITEM.shirtSmallBlue, 'not-an-id'];
  const context = await visitor(browser);
  try {
    for (const path of [...gone.map((id) => `/products/${id}`), '/products']) {
      const page = await context.newPage();
      const response = await page.goto(path);
      expect(response?.status(), path).toBe(404);
      // It is the product page that answers, with the page's own cart indicator: not the site's generic 404.
      await expect(detailOf(page).getByRole('heading', { name: 'This product is no longer available' }), path).toBeVisible();
      await expect(detailOf(page).getByText('Browse the other products.'), path).toBeVisible();
      await expect(detailOf(page).getByRole('link', { name: 'Browse products' }), path).toHaveAttribute('href', '/products');
      await expect(page.locator('[data-ws-store="cartIndicator"] a.ws-cart'), path).toBeVisible();
      await expect(detailOf(page).getByRole('button', { name: 'Add to cart' }), path).toHaveCount(0);
      await page.close();
    }
  } finally {
    await context.close();
  }
});

test('with selling off the product page answers the site\'s own not-found page, not the product page', async ({ browser }) => {
  await patchStore({ selling: false });
  const context = await visitor(browser);
  try {
    const page = await context.newPage();
    const response = await page.goto(`/products/${ITEM.chair}`);
    expect(response?.status()).toBe(404);
    await expect(page.getByText('Page not found')).toBeVisible();
    await expect(page.locator('[data-ws-store="productDetail"]')).toHaveCount(0);
    await expect(page.getByText('This product is no longer available')).toHaveCount(0);
  } finally {
    await patchStore({ selling: true });
    await context.close();
  }
});

test('an element dropped on another page shows the product chosen for it, a plain one with no picker, and adds it', async ({ browser }) => {
  const context = await visitor(browser);
  try {
    const page = await context.newPage();
    const response = await page.goto('/landing');
    expect(response?.status()).toBe(200);
    await expect(detailOf(page).getByRole('heading', { level: 1 })).toHaveText('Desk lamp');
    await expect(priceOf(page)).toContainText('25,000 IQD');
    await expect(detailOf(page).locator('fieldset')).toHaveCount(0);
    await expect(detailOf(page).locator('.ws-sku')).toHaveText('SKU: LMP-001');
    await detailOf(page).getByRole('button', { name: 'Add to cart' }).click();
    await expect(detailOf(page).getByRole('status')).toContainText('Desk lamp added to your cart.');
    await expect(badge(page)).toHaveText('1');
    expect((await readCart(page))?.lines[0]).toMatchObject({ item_id: ITEM.lamp, quantity: 1 });
  } finally {
    await context.close();
  }
});

test('the page reads the item again when it opens: one that has gone since the page was kept shows "no longer available"', async ({ browser }) => {
  const context = await visitor(browser);
  try {
    const page = await context.newPage();
    // The server keeps the product page of this item for a minute.
    const first = await page.goto(`/products/${ITEM.lamp}`);
    expect(first?.status()).toBe(200);
    await expect(detailOf(page).getByRole('heading', { level: 1 })).toHaveText('Desk lamp');

    // The lamp leaves the site's categories: the catalogue stops selling it.
    await patchStore({ category_ids: [CATEGORY.clothing, CATEGORY.toys] });
    const second = await page.goto(`/products/${ITEM.lamp}`);
    expect(second?.status(), 'the kept page is what the server sends').toBe(200);
    await expect(detailOf(page).getByRole('heading', { name: 'This product is no longer available' })).toBeVisible();
    await expect(detailOf(page).getByRole('button', { name: 'Add to cart' })).toHaveCount(0);
  } finally {
    await patchStore({ category_ids: CATEGORIES });
    await context.close();
  }
});

test('a 404 for an item that was not on sale does not stay: once it is, the page answers 200 within a minute', async () => {
  test.setTimeout(150_000);
  // The garden hose is in the Garden category, which the site does not sell from.
  const anonymous = await publishedSite(baseURL, HOST);
  try {
    expect((await anonymous.get(`/products/${ITEM.hose}`)).status()).toBe(404);
    await patchStore({ category_ids: [...CATEGORIES, CATEGORY.garden] });
    await expect.poll(async () => (await anonymous.get(`/products/${ITEM.hose}`)).status(), { timeout: 100_000, intervals: [5_000] }).toBe(200);
    const html = await (await anonymous.get(`/products/${ITEM.hose}`)).text();
    expect(html).toContain('Garden hose');
  } finally {
    await patchStore({ category_ids: CATEGORIES });
    await anonymous.dispose();
  }
});

test('an Arabic page reads right to left in Arabic: names, options, the unit and the notice', async ({ browser }) => {
  const context = await visitor(browser);
  try {
    const page = await context.newPage();
    const response = await page.goto(`/ar/products/${ITEM.shirt}`);
    expect(response?.status()).toBe(200);
    await page.waitForLoadState('networkidle');
    await expect(detailOf(page)).toHaveAttribute('dir', 'rtl');
    await expect(detailOf(page)).toHaveAttribute('lang', 'ar');
    await expect(detailOf(page).getByRole('heading', { level: 1 })).toHaveText('قميص كتان');
    await expect(detailOf(page).locator('.ws-sku')).toContainText('رمز المنتج: SHT-001-S-BLU');
    await expect(priceOf(page)).toContainText('30,400 د.ع');
    await expect(optionRow(page, 'المقاس').getByRole('button')).toHaveText(['صغير', 'وسط · غير متوفر', 'كبير · غير متوفر']);
    await expect(optionRow(page, 'اللون').getByRole('button')).toHaveText(['أبيض', 'أزرق']);
    await expect(detailOf(page).locator('.ws-desc')).toHaveText('كتان مغسول.');
    await detailOf(page).getByRole('button', { name: 'أضف إلى السلة' }).click();
    await expect(detailOf(page).getByRole('status')).toContainText('تمت إضافة قميص كتان (صغير، أزرق) إلى السلة.');
    await expect(detailOf(page).getByRole('link', { name: 'عرض السلة' })).toBeVisible();
    await expect(badge(page)).toHaveText('1');
  } finally {
    await context.close();
  }
});

test('motion: the notice rises and fades in, the chips change colour as they are chosen; a visitor who asks for reduced motion gets a fade and no transition', async ({ browser }) => {
  const motion = await visitor(browser);
  const calm = await visitor(browser, { reducedMotion: 'reduce' });
  try {
    const run = async (context: BrowserContext) => {
      const page = await context.newPage();
      await openProduct(page, `/products/${ITEM.shirt}`);
      const chip = optionRow(page, 'Colour').getByRole('button', { name: 'White' });
      const transition = await chip.evaluate((el) => getComputedStyle(el).transitionProperty);
      await detailOf(page).getByRole('button', { name: 'Add to cart' }).click();
      const notice = detailOf(page).getByRole('status');
      await expect(notice).toBeVisible();
      const animation = await notice.evaluate((el) => getComputedStyle(el).animationName);
      return { transition, animation };
    };
    const full = await run(motion);
    expect(full.animation).toBe('ws-notice-in');
    expect(full.transition).toContain('border-color');
    const reduced = await run(calm);
    expect(reduced.animation).toBe('ws-fade-in');
    expect(reduced.transition).toBe('all');
  } finally {
    await motion.close();
    await calm.close();
  }
});

test('the loading state while the chosen product is asked for, with the status for a screen reader', async ({ browser }) => {
  const context = await visitor(browser);
  try {
    const page = await context.newPage();
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    await page.route(`**/studio/api/store/products/${ITEM.lamp}`, async (route) => {
      await held;
      await route.continue();
    });
    await page.goto('/landing');
    await expect(detailOf(page).locator('.ws-sk-media')).toHaveCount(1);
    await expect(detailOf(page).getByRole('status')).toHaveText('Loading the product…');
    expect(await detailOf(page).locator('.ws-sk').first().evaluate((el) => getComputedStyle(el).animationName)).toBe('ws-pulse');
    release();
    await expect(detailOf(page).getByRole('heading', { level: 1 })).toHaveText('Desk lamp');
  } finally {
    await context.close();
  }
});

test('with Product & Services down the chosen product shows the failure state, and "Try again" shows it once it is back', async ({ browser }) => {
  const context = await visitor(browser);
  try {
    const page = await context.newPage();
    await control(`${PLATFORM}/__down`, { services: ['product-services'] });
    await forgetCatalogue();
    await page.goto('/landing');
    const alert = detailOf(page).getByRole('alert');
    await expect(alert).toContainText('We couldn’t load the products');
    await control(`${PLATFORM}/__down`, { services: [] });
    await alert.getByRole('button', { name: 'Try again' }).click();
    await expect(detailOf(page).getByRole('heading', { level: 1 })).toHaveText('Desk lamp');
  } finally {
    await control(`${PLATFORM}/__down`, { services: [] });
    await context.close();
  }
});

test('with the catalogue down when the page is built, the page is still the page: the element asks again in the browser, and the answer is what it shows', async ({ browser }) => {
  const context = await visitor(browser);
  try {
    const page = await context.newPage();
    await control(`${PLATFORM}/__down`, { services: ['product-services'] });
    await forgetCatalogue();
    // An address no earlier scenario asked for, so the server builds its page now, with the catalogue down: it cannot say whether the item exists.
    const response = await page.goto(`/products/${UNKNOWN_WHILE_DOWN}`);
    expect(response?.status(), 'the server does not call it gone when it could not ask').toBe(200);
    const alert = detailOf(page).getByRole('alert');
    await expect(alert).toContainText('We couldn’t load the products');
    await control(`${PLATFORM}/__down`, { services: [] });
    await forgetCatalogue();
    await alert.getByRole('button', { name: 'Try again' }).click();
    await expect(detailOf(page).getByRole('heading', { name: 'This product is no longer available' })).toBeVisible();
  } finally {
    await control(`${PLATFORM}/__down`, { services: [] });
    await context.close();
  }
});

// ---------------------------------------------------------------------------
// The builder side: the role in the page settings panel, the canvas, the element's settings, the library.
// ---------------------------------------------------------------------------

async function builder(browser: Browser): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ baseURL, storageState: await owner.storageState(), viewport: { width: 1600, height: 1000 } });
  const page = await context.newPage();
  await page.goto(`/ycode/api/platform/sites/${site.id}/open`);
  await expect(page.getByRole('tab', { name: 'Pages' })).toBeVisible({ timeout: 60_000 });
  return { context, page };
}

/** The page's settings panel, from the Pages tab. */
async function openPageSettings(page: Page, name: string): Promise<void> {
  await page.getByRole('tab', { name: 'Pages' }).click();
  await page.getByText(name, { exact: true }).first().click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Page settings' }).click();
}

const storeRoleField = (page: Page) => page.getByText('Store page', { exact: true }).locator('xpath=following::button[@role="combobox"][1]');

async function pageSettings(slug: string): Promise<Record<string, unknown>> {
  const row = (await (await owner.get('/ycode/api/pages')).json()).data.find((p: { slug: string }) => p.slug === slug);
  return row.settings;
}

async function setPageSettings(slug: string, settings: Record<string, unknown>): Promise<void> {
  const row = (await (await owner.get('/ycode/api/pages')).json()).data.find((p: { slug: string }) => p.slug === slug);
  const response = await owner.put(`/ycode/api/pages/${row.id}`, { data: { settings } });
  expect(response.status(), await response.text()).toBe(200);
}

test('the page settings panel offers the Product page role, and a site has one: a second page is refused in words and nothing is saved', async ({ browser }) => {
  await createPage('extra');
  const { context, page } = await builder(browser);
  try {
    await openPageSettings(page, 'extra');
    await expect(storeRoleField(page)).toHaveText('None');
    await storeRoleField(page).click();
    await expect(page.getByRole('option')).toHaveText(['None', 'Product page', 'Cart page', 'Checkout page', 'Confirmation page']);
    await page.getByRole('option', { name: 'Product page' }).click();
    await expect(page.getByText('Answers at /extra/{item id} and shows that item.')).toBeVisible();
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('"products" is already the product page. A site has one page for each store role.')).toBeVisible();
    expect((await pageSettings('extra')).store).toBeUndefined();
    expect((await pageSettings('products')).store).toEqual({ kind: 'product' });
  } finally {
    await context.close();
  }
});

test('a page takes the role once the other has let it go; the role is saved with the page and a publish moves where the elements lead', async ({ browser }) => {
  await setPageSettings('products', {});
  const { context, page } = await builder(browser);
  try {
    await openPageSettings(page, 'extra');
    await storeRoleField(page).click();
    await page.getByRole('option', { name: 'Product page' }).click();
    await page.getByRole('button', { name: 'Save' }).click();
    await expect.poll(async () => (await pageSettings('extra')).store).toEqual({ kind: 'product' });

    // The role the panel saved is the one the publish writes down, and the cards lead to the page now.
    await publish(owner);
    const written = await owner.get('/ycode/api/settings/store_pages');
    expect((await written.json()).data).toEqual({ product: { '*': '/extra', ar: '/ar/extra' } });
    const shopper = await visitor(browser);
    try {
      const home = await shopper.newPage();
      await home.goto('/');
      const shirt = home.locator('[data-ws-store="productGrid"] article', { hasText: 'Linen shirt' });
      await expect(shirt.getByRole('link', { name: 'Choose options' })).toHaveAttribute('href', `/extra/${ITEM.shirt}`);
    } finally {
      await shopper.close();
    }

    // Clearing the role in the panel clears it on the page.
    await openPageSettings(page, 'extra');
    await storeRoleField(page).click();
    await page.getByRole('option', { name: 'None' }).click();
    await page.getByRole('button', { name: 'Save' }).click();
    await expect.poll(async () => (await pageSettings('extra')).store).toBeUndefined();
  } finally {
    await setPageSettings('products', { store: { kind: 'product' } });
    await publish(owner);
    await context.close();
  }
});

test('the builder canvas draws the sample product and never asks the store API; the element\'s settings choose a product from the catalogue', async ({ browser }) => {
  const { context, page } = await builder(browser);
  try {
    const storeCalls: string[] = [];
    page.on('request', (req) => {
      const { pathname } = new URL(req.url());
      if (/^\/(?:ycode|studio)\/api\/store\/(products|categories|settings)/.test(pathname) || pathname.startsWith('/store-media/')) storeCalls.push(`${req.method()} ${pathname}`);
    });
    // Open the product page: its layers are the page's own (the cart indicator and the Product page element).
    await expect(async () => {
      await page.getByRole('tab', { name: 'Pages' }).click();
      await page.getByRole('tabpanel', { name: 'Pages' }).getByText('products', { exact: true }).click();
      await page.getByRole('tab', { name: 'Layers' }).click();
      await expect(page.getByRole('tabpanel', { name: 'Layers' }).getByRole('button', { name: 'Product page' })).toBeVisible({ timeout: 3000 });
    }).toPass({ timeout: 30_000 });
    const canvas = page.frameLocator('iframe').first();
    const sample = canvas.locator('[data-ws-store="productDetail"]');
    await expect(sample.getByRole('heading', { level: 1 })).toHaveText('Cotton T-shirt', { timeout: 60_000 });
    await expect(sample.locator('.ws-sku')).toHaveText('SKU: TS-001-BLK-M');
    await expect(sample.locator('.ws-pd-price')).toContainText('25,000 IQD');
    await expect(optionRowIn(sample, 'Colour').getByRole('button')).toHaveText(['Black', 'White', 'Navy', 'Grey · unavailable']);
    await expect(optionRowIn(sample, 'Size').getByRole('button')).toHaveText(['S', 'M', 'L', 'XL · unavailable']);
    await expect(sample.locator('.ws-thumb')).toHaveCount(4);
    await expect(sample.getByRole('button', { name: 'Add to cart' })).toBeVisible();

    // Selecting it opens its own settings.
    await sample.click({ position: { x: 4, y: 4 } });
    await page.getByRole('tab', { name: 'Settings' }).click();
    await expect(page.getByText('On the page set as the product page, the element shows the item in the address.')).toBeVisible();
    await page.getByRole('button', { name: 'Choose a product' }).click();
    await page.getByPlaceholder('Search by name').fill('shirt');
    await expect(page.getByRole('button', { name: /Linen shirt\s*SHT-001/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Desk lamp\s*LMP-001/ })).toHaveCount(0);
    await page.waitForTimeout(1000);
    expect(storeCalls, 'the canvas never asks for a product or a picture').toEqual([]);
  } finally {
    await context.close();
  }
});

const optionRowIn = (scope: ReturnType<Page['locator']>, axis: string) => scope.locator('fieldset').filter({ hasText: axis });

test('the Store category of the library lists the Product page element and the Layouts tab a Product page section, with its preview', async ({ browser }) => {
  const { context, page } = await builder(browser);
  try {
    await page.getByRole('tab', { name: 'Layers' }).click();
    await page.getByRole('tabpanel', { name: 'Layers' }).getByText('Layers', { exact: true }).locator('xpath=following::button[1]').click();
    const elements = page.getByRole('tabpanel', { name: 'Elements' });
    await expect(elements.getByText('Product page', { exact: true })).toBeVisible();
    await expect(elements.getByText('Product grid', { exact: true })).toBeVisible();

    await page.getByRole('tab', { name: 'Layouts' }).click();
    const layouts = page.getByRole('tabpanel', { name: 'Layouts' });
    await layouts.getByText('Store', { exact: true }).click();
    const preview = layouts.locator('img[src*="store-product-page"]');
    await expect(preview).toBeVisible();
    await expect.poll(() => preview.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
  } finally {
    await context.close();
  }
});
