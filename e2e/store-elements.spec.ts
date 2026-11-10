/**
 * Part 2, session W4 "done when": the store elements. A page with a product
 * grid, a product card and a cart indicator publishes and shows the stub
 * catalogue; the grid filters by the URL's category, searches, shows the empty
 * state of an empty category and the failure state with the stub down, and pages
 * with "Load more"; the canvas shows sample data and calls the store API never.
 *
 * The catalogue organization of e2e/platform-fixtures.ts, as catalogue.spec.ts
 * has it: the site sells from Clothing and Home (and Toys, which has nothing in
 * it), so it sells the desk lamp and the linen shirt (one product, "from" the
 * cheapest variant, 30,400 IQD). The buyer's cart is W5's: a published page
 * connects it from localStorage (`ws-cart:{siteId}`), so the specs here seed that
 * key before the page starts and read it back after.
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, request, test, type APIRequestContext, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { createSite, draftPages, openSite, publish, signIn, TEST_SITES_DOMAIN, type SiteRecord } from './helpers';
import { BRANCH, CATALOGUE_ORG, CATEGORY, ITEM } from './platform-fixtures';

test.describe.configure({ mode: 'serial' });

const RUN = Date.now().toString(36);
const PORT = Number(process.env.E2E_PORT || 3102);
const PLATFORM = `http://127.0.0.1:${Number(process.env.E2E_PLATFORM_PORT || PORT + 3)}`;
const SLUG = `els-${RUN}`;
const HOST = `${SLUG}.${TEST_SITES_DOMAIN}`;
const OWNER = { sub: '75757575-7575-4575-8575-757575757575', email: 'owner-elements@example.com', name: 'Elements Owner', org: CATALOGUE_ORG };
/** Reads the site but may not change pages: the settings pickers answer it 403. */
const READER = { sub: '76767676-7676-4676-8676-767676767676', email: 'reader-elements@example.com', name: 'Reader', org: CATALOGUE_ORG, perms: { 'webstudio.manage_sites': ['r'] } };

let baseURL: string;
let owner: APIRequestContext;
let site: SiteRecord;
let storageState: Awaited<ReturnType<APIRequestContext['storageState']>>;
let fee = 4000;

const grid = (id: string, settings: Record<string, unknown> = {}) => ({
  id,
  name: 'productGrid',
  classes: 'w-full',
  settings: { tag: 'div', store: { productGrid: settings } },
  children: [],
});
const card = (id: string, product: { id: string; name: string; name_ar: string | null } | null) => ({
  id,
  name: 'productCard',
  classes: 'w-full',
  settings: { tag: 'div', store: { productCard: { product } } },
  children: [],
});
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
const servicesDown = (services: Array<'org-setup' | 'product-services'>) => control(`${PLATFORM}/__down`, { services });

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

/** The buyer's cart as W5 keeps it: `count` pieces of one item in localStorage under the site's key, there before the page starts. */
async function seedCart(context: BrowserContext, count: number): Promise<void> {
  await context.addInitScript(({ key, pieces }: { key: string; pieces: number }) => {
    if (window.localStorage.getItem(key)) return;
    const line = { item_id: 'seeded', product_id: 'seeded', quantity: pieces, snapshot: { name: 'Seeded', name_ar: null, axes: [], price: { amount: '1000', currency: 'IQD' }, image: null, unit: null } };
    window.localStorage.setItem(key, JSON.stringify({ version: 1, lines: [line] }));
  }, { key: `ws-cart:${site.id}`, pieces: count });
}

const cartLines = (page: Page) =>
  page.evaluate((key) => (JSON.parse(window.localStorage.getItem(key) ?? 'null') as { lines: Array<Record<string, unknown>> } | null)?.lines ?? [], `ws-cart:${site.id}`);

async function visitor(browser: Browser, options: { lang?: string } = {}): Promise<BrowserContext> {
  return browser.newContext({ baseURL, extraHTTPHeaders: { 'x-forwarded-host': HOST }, locale: options.lang });
}

const gridOf = (page: Page) => page.locator('[data-ws-store="productGrid"]').first();
const cards = (page: Page) => gridOf(page).locator('article.ws-card');
/** The names of the cards shown, waited for: the list is replaced as the products arrive. */
const expectNames = (page: Page, names: string[]) => expect(cards(page).locator('.ws-card-name')).toHaveText(names);

test.beforeAll(async ({ baseURL: configured }) => {
  baseURL = configured!;
  await servicesDown([]);
  owner = await signIn(baseURL, OWNER);
  site = await createSite(owner, { name: 'Elements Store', slug: SLUG, languages: ['en', 'ar'], default_language: 'en' });
  expect(site.hosts[0]).toBe(HOST);
  expect((await openSite(owner, site.id)).status()).toBe(303);
  await patchStore({ branch_id: BRANCH.catalogue, category_ids: [CATEGORY.clothing, CATEGORY.home, CATEGORY.toys], delivery_fee: fee, selling: true });

  const home = (await draftPages(owner)).find((page) => page.is_index)!;
  await putLayers(home.id, body(
    indicator('cart'),
    grid('grid'),
    card('card', { id: ITEM.lamp, name: 'Desk lamp', name_ar: 'مصباح مكتب' }),
  ));

  const created = async (slug: string) => {
    const response = await owner.post('/ycode/api/pages', { data: { name: slug, slug } });
    expect(response.status() < 300, await response.text()).toBe(true);
    return (await response.json()).data.id as string;
  };
  await putLayers(await created('paged'), body(grid('paged-grid', { pageSize: 1, showSearch: false, showCategoryFilter: false })));
  await putLayers(await created('only-home'), body(grid('home-grid', { categories: [CATEGORY.home] })));
  await putLayers(await created('no-url'), body(grid('plain-grid', { honourUrlCategory: false, showSearch: false })));
  await publish(owner);
  storageState = await owner.storageState();
});

test.afterAll(async () => {
  await servicesDown([]);
  if (site) await owner.delete(`/ycode/api/platform/sites/${site.id}`);
  await owner?.dispose();
});

test('a published grid shows the stub catalogue: the lamp with Add to cart, the shirt "from" its cheapest variant with Choose options, and the category chips', async ({ browser }) => {
  const context = await visitor(browser);
  try {
    const page = await context.newPage();
    const response = await page.goto('/');
    expect(response?.status()).toBe(200);
    await expectNames(page, ['Desk lamp', 'Linen shirt']);
    const lamp = cards(page).nth(0);
    await expect(lamp.locator('.ws-card-price')).toHaveText('25,000 IQD');
    await expect(lamp.getByRole('button', { name: 'Add to cart' })).toBeVisible();
    await expect(lamp.locator('img')).toHaveAttribute('src', new RegExp(`/store-media/.+item=${ITEM.lamp}`));
    expect(await lamp.locator('img').evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0), 'the image is served by the site').toBe(true);

    const shirt = cards(page).nth(1);
    await expect(shirt.locator('.ws-card-price')).toHaveText('from 30,400 IQD');
    const choose = shirt.getByRole('link', { name: 'Choose options' });
    await expect(choose).toHaveAttribute('href', `/product/${ITEM.shirt}`);
    await expect(shirt.getByRole('button', { name: 'Add to cart' })).toHaveCount(0);

    const chips = gridOf(page).getByRole('group', { name: 'Categories' }).getByRole('button');
    await expect(chips).toHaveText(['All', 'Clothing', 'Home', 'Toys']);
    await expect(chips.first()).toHaveAttribute('aria-pressed', 'true');
    await expect(gridOf(page).getByRole('searchbox', { name: 'Search products by name' })).toBeVisible();

    // The wrapper is the layer: its classes are on it, the store's language and direction too.
    await expect(gridOf(page)).toHaveClass(/\bw-full\b/);
    await expect(gridOf(page)).toHaveAttribute('dir', 'ltr');
    await expect(gridOf(page)).toHaveAttribute('lang', 'en');
  } finally {
    await context.close();
  }
});

test('the first paint is the skeleton while the products are asked for, with the status for a screen reader', async ({ browser }) => {
  const context = await visitor(browser);
  try {
    const page = await context.newPage();
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    await page.route('**/studio/api/store/products?*', async (route) => {
      await held;
      await route.continue();
    });
    await page.goto('/');
    await expect(gridOf(page).locator('.ws-sk-media')).toHaveCount(8);
    await expect(gridOf(page).getByRole('status')).toHaveText('Loading products…');
    expect(await gridOf(page).locator('.ws-sk').first().evaluate((el) => getComputedStyle(el).animationName)).toBe('ws-pulse');
    release();
    await expect(cards(page)).toHaveCount(2);
    await expect(gridOf(page).locator('.ws-sk')).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test('the skeleton does not pulse when the visitor asks for reduced motion', async ({ browser }) => {
  const context = await browser.newContext({ baseURL, extraHTTPHeaders: { 'x-forwarded-host': HOST }, reducedMotion: 'reduce' });
  try {
    const page = await context.newPage();
    await page.route('**/studio/api/store/products?*', () => { /* held: the skeleton stays */ });
    await page.goto('/');
    await expect(gridOf(page).locator('.ws-sk-media')).toHaveCount(8);
    expect(await gridOf(page).locator('.ws-sk').first().evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
  } finally {
    await context.close();
  }
});

test('the URL\'s ?category= filters the grid (a category lists what is under it), a chip does the same and writes the URL, a made-up one is ignored', async ({ browser }) => {
  const context = await visitor(browser);
  try {
    const page = await context.newPage();
    await page.goto(`/?category=${CATEGORY.home}`);
    await expectNames(page, ['Desk lamp']);
    const chips = gridOf(page).getByRole('group', { name: 'Categories' });
    await expect(chips.getByRole('button', { name: 'Home' })).toHaveAttribute('aria-pressed', 'true');
    await expect(chips.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'false');

    // Clothing holds the shirt through its subcategory Shirts.
    await page.goto(`/?category=${CATEGORY.clothing}`);
    await expectNames(page, ['Linen shirt']);

    await chips.getByRole('button', { name: 'Home' }).click();
    await expectNames(page, ['Desk lamp']);
    expect(new URL(page.url()).searchParams.get('category')).toBe(CATEGORY.home);
    await chips.getByRole('button', { name: 'All' }).click();
    await expect(cards(page)).toHaveCount(2);
    expect(new URL(page.url()).searchParams.has('category')).toBe(false);

    await page.goto('/?category=not-an-id');
    await expect(cards(page)).toHaveCount(2);
  } finally {
    await context.close();
  }
});

test('a grid that does not honour the URL category lists everything, whatever the URL says', async ({ browser }) => {
  const context = await visitor(browser);
  try {
    const page = await context.newPage();
    await page.goto(`/no-url?category=${CATEGORY.home}`);
    await expect(cards(page)).toHaveCount(2);
    await expect(gridOf(page).getByRole('searchbox')).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test('the search field finds a product by name as it is typed, writes ?q= to the URL, reads it back, and says so when nothing matches', async ({ browser }) => {
  const context = await visitor(browser);
  try {
    const page = await context.newPage();
    await page.goto('/');
    await expect(cards(page)).toHaveCount(2);
    const search = gridOf(page).getByRole('searchbox', { name: 'Search products by name' });
    await search.fill('lamp');
    await expectNames(page, ['Desk lamp']);
    expect(new URL(page.url()).searchParams.get('q')).toBe('lamp');

    await search.fill('wool shirt');
    await expect(gridOf(page).getByRole('heading', { name: 'No results for “wool shirt”' })).toBeVisible();
    await expect(cards(page)).toHaveCount(0);
    await gridOf(page).getByRole('button', { name: 'Clear search' }).click();
    await expect(cards(page)).toHaveCount(2);
    await expect(search).toHaveValue('');
    expect(new URL(page.url()).searchParams.has('q')).toBe(false);

    // The page's own ?q= is read when it opens, and the field shows it.
    await page.goto('/?q=shirt');
    await expect(cards(page)).toHaveCount(1);
    await expect(search).toHaveValue('shirt');

    // Arabic names are searched too (the stub's shirt is قميص كتان).
    await search.fill('كتان');
    await expectNames(page, ['Linen shirt']);
  } finally {
    await context.close();
  }
});

test('a category with nothing in it shows the empty state naming it, and "Show all products" leaves it', async ({ browser }) => {
  const context = await visitor(browser);
  try {
    const page = await context.newPage();
    await page.goto(`/?category=${CATEGORY.toys}`);
    await expect(gridOf(page).getByRole('heading', { name: 'No products in “Toys” yet' })).toBeVisible();
    await expect(gridOf(page).getByText('Browse the other categories, or check back later.')).toBeVisible();
    await expect(cards(page)).toHaveCount(0);
    await gridOf(page).getByRole('button', { name: 'Show all products' }).click();
    await expect(cards(page)).toHaveCount(2);
    expect(new URL(page.url()).searchParams.has('category')).toBe(false);
  } finally {
    await context.close();
  }
});

test('with Product & Services down the grid shows the failure state, and "Try again" shows the products once it is back', async ({ browser }) => {
  const context = await visitor(browser);
  try {
    const page = await context.newPage();
    await servicesDown(['product-services']);
    await forgetCatalogue();
    await page.goto('/');
    const alert = gridOf(page).getByRole('alert');
    await expect(alert).toContainText('We couldn’t load the products');
    await expect(alert).toContainText('Try again in a moment');
    await expect(cards(page)).toHaveCount(0);

    await servicesDown([]);
    await alert.getByRole('button', { name: 'Try again' }).click();
    await expect(cards(page)).toHaveCount(2);
    await expect(gridOf(page).getByRole('alert')).toHaveCount(0);
  } finally {
    await servicesDown([]);
    await context.close();
  }
});

test('the grid\'s own categories narrow the chips and the list, and the page size is a page: "Load more" adds the next one', async ({ browser }) => {
  const context = await visitor(browser);
  try {
    const page = await context.newPage();
    await page.goto('/only-home');
    await expectNames(page, ['Desk lamp']);
    await expect(gridOf(page).getByRole('group', { name: 'Categories' }).getByRole('button')).toHaveText(['All', 'Home']);

    await page.goto('/paged');
    await expect(cards(page)).toHaveCount(1);
    await expect(gridOf(page).getByRole('searchbox')).toHaveCount(0);
    await expect(gridOf(page).getByRole('group', { name: 'Categories' })).toHaveCount(0);
    const more = gridOf(page).getByRole('button', { name: 'Load more' });
    await expect(more).toBeVisible();
    await more.click();
    await expectNames(page, ['Desk lamp', 'Linen shirt']);
    await expect(more).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test('with selling off every store element renders nothing; switched on again they are back', async ({ browser }) => {
  const context = await visitor(browser);
  try {
    const page = await context.newPage();
    await patchStore({ selling: false });
    await page.goto('/');
    await expect(page.locator('[data-ws-store="cartIndicator"] .ws-cart')).toHaveCount(0);
    await expect(gridOf(page).locator('.ws-grid-root')).toHaveCount(0);
    await expect(page.locator('[data-ws-store="productCard"] article')).toHaveCount(0);
    expect(await page.locator('[data-ws-store="productGrid"] article').count()).toBe(0);

    await patchStore({ selling: true });
    await page.goto('/');
    await expect(cards(page)).toHaveCount(2);
    await expect(page.locator('[data-ws-store="cartIndicator"] .ws-cart')).toBeVisible();
    await expect(page.locator('[data-ws-store="productCard"] article')).toHaveCount(1);
  } finally {
    await patchStore({ selling: true });
    await context.close();
  }
});

test('a product card alone shows the product it was given, with its own Add to cart', async ({ browser }) => {
  const context = await visitor(browser);
  try {
    const page = await context.newPage();
    await page.goto('/');
    const lone = page.locator('[data-ws-store="productCard"]');
    await expect(lone.locator('article')).toHaveCount(1);
    await expect(lone.locator('.ws-card-name')).toHaveText('Desk lamp');
    await expect(lone.locator('.ws-card-price')).toHaveText('25,000 IQD');
    await expect(page.locator('[data-ws-store="productGrid"] article')).toHaveCount(2);
    await lone.getByRole('button', { name: 'Add to cart' }).click();
    await expect(page.locator('[data-ws-store="cartIndicator"] .ws-badge')).toHaveText('1');
    expect(await cartLines(page)).toEqual([{
      item_id: ITEM.lamp,
      product_id: ITEM.lamp,
      quantity: 1,
      snapshot: {
        name: 'Desk lamp',
        name_ar: 'مصباح مكتب',
        axes: [],
        price: { amount: '25000', currency: 'IQD' },
        image: expect.stringContaining('/store-media/'),
        unit: { name: 'Piece', symbol: 'pcs' },
      },
    }]);
  } finally {
    await context.close();
  }
});

test('the cart indicator shows the cart\'s count, follows it (here and in another tab), settles the badge once on a change, and says 99+ above 99', async ({ browser }) => {
  const context = await visitor(browser);
  try {
    await seedCart(context, 3);
    const page = await context.newPage();
    await page.goto('/');
    const cart = page.locator('[data-ws-store="cartIndicator"] a.ws-cart');
    await expect(cart).toHaveAttribute('aria-label', 'Cart: 3 items');
    // No page has the cart role yet (W6 gives it): the indicator goes nowhere rather than to a page that is not there.
    await expect(cart).toHaveAttribute('href', '#');
    await expect(cart.locator('.ws-badge')).toHaveText('3');
    // The buyer's own count on opening is not a change: the badge does not settle.
    await expect(cart.locator('.ws-badge')).not.toHaveAttribute('data-changed', /.*/);

    await expect(cards(page)).toHaveCount(2);
    await cards(page).first().getByRole('button', { name: 'Add to cart' }).click();
    await expect(cart).toHaveAttribute('aria-label', 'Cart: 4 items');
    await expect(cart.locator('.ws-badge')).toHaveText('4');
    await expect(cart.locator('.ws-badge')).toHaveAttribute('data-changed', '');

    // Another tab of the same site changes the cart: this one follows.
    const other = await context.newPage();
    await other.goto('/');
    await other.evaluate((key) => {
      const stored = JSON.parse(window.localStorage.getItem(key)!);
      stored.lines[0].quantity = 120;
      window.localStorage.setItem(key, JSON.stringify(stored));
    }, `ws-cart:${site.id}`);
    await expect(cart.locator('.ws-badge')).toHaveText('99+');
    await expect(cart).toHaveAttribute('aria-label', 'Cart: 121 items');

    await other.evaluate((key) => window.localStorage.removeItem(key), `ws-cart:${site.id}`);
    await expect(cart.locator('.ws-badge')).toHaveCount(0);
    await expect(cart).toHaveAttribute('aria-label', 'Cart is empty');
  } finally {
    await context.close();
  }
});

test('an Arabic page reads right to left in Arabic, names and prices included, and links under /ar', async ({ browser }) => {
  const context = await visitor(browser);
  try {
    const page = await context.newPage();
    await page.goto('/ar');
    await expect(cards(page)).toHaveCount(2);
    await expect(gridOf(page)).toHaveAttribute('dir', 'rtl');
    await expect(gridOf(page)).toHaveAttribute('lang', 'ar');
    await expectNames(page, ['مصباح مكتب', 'قميص كتان']);
    await expect(cards(page).nth(0).locator('.ws-card-price')).toHaveText('25,000 د.ع');
    await expect(cards(page).nth(0).getByRole('button', { name: 'أضف إلى السلة' })).toBeVisible();
    await expect(cards(page).nth(1).getByRole('link', { name: 'اختر الخيارات' })).toHaveAttribute('href', `/ar/product/${ITEM.shirt}`);
    await expect(gridOf(page).getByRole('group', { name: 'الأقسام' }).getByRole('button')).toHaveText(['الكل', 'ملابس', 'المنزل', 'ألعاب']);
    await expect(gridOf(page).getByRole('searchbox', { name: 'ابحث عن منتج بالاسم' })).toBeVisible();
    await expect(page.locator('[data-ws-store="cartIndicator"] a.ws-cart')).toHaveAttribute('href', '#');
    // The search field's icon sits at the start edge, which is the right one here.
    const field = gridOf(page).locator('.ws-search-input');
    const icon = gridOf(page).locator('.ws-search-icon');
    const [fieldBox, iconBox] = [await field.boundingBox(), await icon.boundingBox()];
    expect(iconBox!.x).toBeGreaterThan(fieldBox!.x + fieldBox!.width / 2);
  } finally {
    await context.close();
  }
});

test('the page\'s font is IBM Plex Sans Arabic from this site, never Google', async ({ browser }) => {
  const context = await visitor(browser);
  try {
    const page = await context.newPage();
    const external: string[] = [];
    page.on('request', (req) => {
      const host = new URL(req.url()).hostname;
      if (host.includes('googleapis') || host.includes('gstatic')) external.push(req.url());
    });
    await page.goto('/');
    await expect(cards(page)).toHaveCount(2);
    await expect(page.locator('link[rel="stylesheet"][href="/studio/api/store/font"]').first()).toBeAttached();
    expect(await gridOf(page).evaluate((el) => getComputedStyle(el).fontFamily)).toContain('IBM Plex Sans Arabic');
    expect(external, 'no request leaves for a public font CDN').toEqual([]);
  } finally {
    await context.close();
  }
});

test('the font routes serve this one family to anyone, and nothing else the mirror holds', async () => {
  const anonymous = await request.newContext({ baseURL });
  try {
    const css = await anonymous.get('/ycode/api/store/font');
    // Without the network the mirror cannot fetch the family from Google the first time (a 502); with it, the stylesheet points at this site.
    expect([200, 502]).toContain(css.status());
    if (css.status() === 200) {
      const text = await css.text();
      expect(css.headers()['content-type']).toContain('text/css');
      expect(text).toContain('IBM Plex Sans Arabic');
      expect(text).toContain('/studio/api/store/font/files/ibmplexsansarabic/');
      expect(text).not.toContain('gstatic');
      expect(text).not.toContain('/ycode/api/fonts/mirror');
    }
    expect((await anonymous.get('/ycode/api/store/font/files/inter/v18/x.woff2')).status()).toBe(404);
    expect((await anonymous.get('/ycode/api/store/font/files/ibmplexsansarabic')).status()).toBe(404);
    // The mirror's own routes are still the builder's: no session, no font.
    expect((await anonymous.get('/ycode/api/fonts/mirror/css2?family=Inter')).status()).toBe(401);
  } finally {
    await anonymous.dispose();
  }
});

test('the settings pickers read the open site\'s catalogue for those who may edit pages, and for nobody else', async () => {
  const categories = await owner.get('/ycode/api/platform/store-elements/categories');
  expect(categories.status(), await categories.text()).toBe(200);
  expect((await categories.json()).data).toEqual([
    { id: CATEGORY.clothing, name: 'Clothing', name_ar: 'ملابس', item_count: 1 },
    { id: CATEGORY.home, name: 'Home', name_ar: 'المنزل', item_count: 1 },
    { id: CATEGORY.toys, name: 'Toys', name_ar: 'ألعاب', item_count: 0 },
  ]);

  const all = await owner.get('/ycode/api/platform/store-elements/products');
  expect((await all.json())).toEqual({
    data: [
      { id: ITEM.lamp, sku: 'LMP-001', name: 'Desk lamp', name_ar: 'مصباح مكتب' },
      { id: ITEM.shirt, sku: 'SHT-001', name: 'Linen shirt', name_ar: 'قميص كتان' },
    ],
    meta: { page: 1, total: 2 },
  });
  const found = await owner.get('/ycode/api/platform/store-elements/products?q=LAMP');
  expect((await found.json()).data.map((p: { id: string }) => p.id)).toEqual([ITEM.lamp]);
  expect((await owner.get('/ycode/api/platform/store-elements/products?page=0')).status()).toBe(400);

  // They work before the store sells: a site is built before it is switched on.
  await patchStore({ selling: false });
  try {
    expect((await owner.get('/ycode/api/platform/store-elements/products')).status()).toBe(200);
  } finally {
    await patchStore({ selling: true });
  }

  const reader = await signIn(baseURL, READER);
  try {
    expect((await openSite(reader, site.id)).status()).toBe(303);
    for (const path of ['categories', 'products']) expect((await reader.get(`/ycode/api/platform/store-elements/${path}`)).status()).toBe(403);
  } finally {
    await reader.dispose();
  }
  const anonymous = await request.newContext({ baseURL });
  try {
    for (const path of ['categories', 'products']) expect((await anonymous.get(`/ycode/api/platform/store-elements/${path}`)).status()).toBe(401);
  } finally {
    await anonymous.dispose();
  }
});

test('the static export of the page carries each element\'s shell, the grid with its skeleton, and no error', async () => {
  const out = await fs.mkdtemp(path.join(os.tmpdir(), 'ws-store-export-'));
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

    let job: { status: string; error: string | null; pagesExported: number } | null = null;
    await expect.poll(async () => {
      job = (await (await owner.get('/ycode/api/apps/static-export/status')).json()).data;
      return job?.status;
    }, { timeout: 60_000 }).not.toBe('running');
    expect(job, 'the export finished').toMatchObject({ status: 'completed', error: null });

    const html = await fs.readFile(path.join(out, 'index.html'), 'utf8');
    expect(html).toContain('data-ws-store="productGrid"');
    expect(html).toContain('data-ws-store="productCard"');
    expect(html).toContain('data-ws-store="cartIndicator"');
    expect(html).toContain('role="status">Loading products…');
    // The grid's skeleton: eight cards, since the data is live and a static page has no script to ask for it.
    expect(html.split('class="ws-sk ws-sk-media"').length - 1).toBe(8 + 1); // the grid's eight and the lone card's one
    expect(html).toContain('aria-label="Cart is empty"');
    // A static page has no platform behind it: the shell asks for no font (the export would have rewritten the link into a dead one).
    expect(html).not.toContain('/studio/api/store/font');
    expect(html).not.toContain('googleapis');
  } finally {
    await fs.rm(out, { recursive: true, force: true });
  }
});

test('the builder canvas draws the sample data and never asks the store API', async ({ browser }) => {
  const context = await browser.newContext({ baseURL, storageState, viewport: { width: 1600, height: 1000 } });
  try {
    const page = await context.newPage();
    const storeCalls: string[] = [];
    page.on('request', (req) => {
      const { pathname } = new URL(req.url());
      // The font is the platform's own stylesheet, asked for by any page that draws a store element; the catalogue is what the canvas must not ask.
      if (/^\/(?:ycode|studio)\/api\/store\/(products|categories|settings)/.test(pathname) || pathname.startsWith('/store-media/')) storeCalls.push(`${req.method()} ${pathname}`);
    });
    await page.goto(`/ycode/api/platform/sites/${site.id}/open`);
    const canvas = page.frameLocator('iframe').first();
    const sampleGrid = canvas.locator('[data-ws-store="productGrid"]');
    await expect(sampleGrid.locator('article.ws-card')).toHaveCount(8, { timeout: 60_000 });
    await expect(sampleGrid.locator('.ws-card-name')).toContainText(['Cotton T-shirt', 'Wool hoodie', 'Canvas tote bag', 'Leather wallet']);
    await expect(sampleGrid.locator('.ws-card-price').first()).toHaveText('from 25,000 IQD');
    await expect(sampleGrid.getByRole('group', { name: 'Categories' }).getByRole('button')).toHaveText(['All', 'Men', 'Women', 'Accessories']);
    await expect(canvas.locator('[data-ws-store="cartIndicator"] .ws-badge')).toHaveText('4');
    // A card with a product chosen carries its name; the price and the picture are the sample's.
    await expect(canvas.locator('[data-ws-store="productCard"] .ws-card-name')).toHaveText('Desk lamp');
    await page.waitForTimeout(1500);
    expect(storeCalls, 'the canvas never calls the store API or asks for a product image').toEqual([]);
  } finally {
    await context.close();
  }
});

test('selecting a store element in the builder opens its settings: the grid\'s and the card\'s', async ({ browser }) => {
  const context = await browser.newContext({ baseURL, storageState, viewport: { width: 1600, height: 1000 } });
  try {
    const page = await context.newPage();
    await page.goto(`/ycode/api/platform/sites/${site.id}/open`);
    const canvas = page.frameLocator('iframe').first();
    await expect(canvas.locator('[data-ws-store="productGrid"] article.ws-card').first()).toBeVisible({ timeout: 60_000 });

    // A click on the canvas selects the layer like any other; the element's own settings are on the Settings tab.
    await canvas.locator('[data-ws-store="productGrid"]').first().click({ position: { x: 4, y: 4 } });
    await page.getByRole('tab', { name: 'Settings' }).click();
    await expect(page.getByText('Page size')).toBeVisible();
    await expect(page.getByText('Show category filter')).toBeVisible();
    await page.getByRole('button', { name: 'All categories' }).click();
    await expect(page.getByRole('menuitemcheckbox', { name: 'Clothing' })).toBeVisible();
    await expect(page.getByRole('menuitemcheckbox', { name: 'Toys' })).toBeVisible();
    await page.keyboard.press('Escape');

    await canvas.locator('[data-ws-store="productCard"]').click({ position: { x: 4, y: 4 } });
    await page.getByRole('tab', { name: 'Settings' }).click();
    await expect(page.getByText('Page size')).toHaveCount(0);
    await page.getByRole('button', { name: 'Desk lamp' }).click();
    await page.getByPlaceholder('Search by name').fill('shirt');
    await expect(page.getByRole('button', { name: /Linen shirt\s*SHT-001/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Desk lamp\s*LMP-001/ })).toHaveCount(0);
  } finally {
    await context.close();
  }
});
