/**
 * Part 2, session 25 (F2): what Task B's templates need from the store elements
 * (OPEN_QUESTIONS 55 to 58 of features/storefront-and-cart).
 *
 *   - The category cards ("Shop by category"): one card per category the site
 *     sells from, with its first product's picture, a link to the products page
 *     listing that category; nothing for a category with no product.
 *   - The product grid's count ("3 products"), of everything the grid lists,
 *     whatever chip or search is on.
 *   - A product card with no product picked shows one of the store's first
 *     products, by its place among the page's unpicked cards; a picked card
 *     still shows its pick.
 *   - The product page's breadcrumb: Products, the item's category, the product.
 *
 * The catalogue organization of e2e/platform-fixtures.ts, selling from Clothing,
 * Home, Garden and Toys: the desk lamp (Home, with a picture), the garden hose
 * (Garden, no picture), the linen shirt (Clothing through Shirts, with a
 * picture), and nothing in Toys.
 */

import { expect, request, test, type APIRequestContext, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { createSite, draftPages, openSite, publish, signIn, TEST_SITES_DOMAIN, type SiteRecord } from './helpers';
import { BRANCH, CATALOGUE_ORG, CATEGORY, IMAGE, ITEM } from './platform-fixtures';

test.describe.configure({ mode: 'serial' });

const RUN = Date.now().toString(36);
const PORT = Number(process.env.E2E_PORT || 3102);
const PLATFORM = `http://127.0.0.1:${Number(process.env.E2E_PLATFORM_PORT || PORT + 3)}`;
const SLUG = `home-${RUN}`;
const HOST = `${SLUG}.${TEST_SITES_DOMAIN}`;
const OWNER = { sub: '85858585-8585-4585-8585-858585858585', email: 'owner-shop-home@example.com', name: 'Shop Home Owner', org: CATALOGUE_ORG };

let baseURL: string;
let owner: APIRequestContext;
let site: SiteRecord;
let fee = 6000;

const element = (id: string, name: string, extra: Record<string, unknown> = {}) => ({ id, name, classes: 'w-full', settings: { tag: 'div', ...extra }, children: [] });
const grid = (id: string, settings: Record<string, unknown> = {}) => element(id, 'productGrid', { store: { productGrid: settings } });
const card = (id: string, product: { id: string; name: string; name_ar: string | null } | null) => element(id, 'productCard', { store: { productCard: { product } } });
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

async function createPage(slug: string, settings: Record<string, unknown> = {}): Promise<string> {
  const response = await owner.post('/ycode/api/pages', { data: { name: slug, slug, settings } });
  expect(response.status() < 300, await response.text()).toBe(true);
  return (await response.json()).data.id as string;
}

async function visitor(browser: Browser): Promise<BrowserContext> {
  return browser.newContext({ baseURL, extraHTTPHeaders: { 'x-forwarded-host': HOST } });
}

const categoriesOf = (page: Page) => page.locator('[data-ws-store="categoryCards"]').first();
const categoryLinks = (page: Page) => categoriesOf(page).locator('a.ws-cat-card');
const gridOf = (page: Page) => page.locator('[data-ws-store="productGrid"]').first();
const gridCards = (page: Page) => gridOf(page).locator('article.ws-card');
const countOf = (page: Page) => gridOf(page).locator('.ws-count');
const loneCards = (page: Page) => page.locator('[data-ws-store="productCard"]');
const crumbsOf = (page: Page) => page.locator('[data-ws-store="productDetail"]').getByRole('navigation', { name: 'Breadcrumb' });

test.beforeAll(async ({ baseURL: configured }) => {
  baseURL = configured!;
  await servicesDown([]);
  owner = await signIn(baseURL, OWNER);
  site = await createSite(owner, { name: 'Shop Home', slug: SLUG, languages: ['en', 'ar'], default_language: 'en' });
  expect(site.hosts[0]).toBe(HOST);
  expect((await openSite(owner, site.id)).status()).toBe(303);
  await patchStore({ branch_id: BRANCH.catalogue, category_ids: [CATEGORY.clothing, CATEGORY.home, CATEGORY.garden, CATEGORY.toys], delivery_fee: fee, selling: true });

  // The shop home: the category cards, then "Featured products" as the section has it, four cards with nothing picked.
  const home = (await draftPages(owner)).find((page) => page.is_index)!;
  await putLayers(home.id, body(element('cats', 'categoryCards'), card('f1', null), card('f2', null), card('f3', null), card('f4', null)));
  // The products page (the conventional /products the category cards and the breadcrumb link to), with the count.
  await putLayers(await createPage('products'), body(grid('counted', { showCount: true })));
  // A grid as it was before the count existed: no setting for it.
  await putLayers(await createPage('uncounted'), body(grid('plain')));
  // One card with a pick and two without.
  await putLayers(await createPage('picked'), body(card('p1', { id: ITEM.hose, name: 'Garden hose', name_ar: 'خرطوم حديقة' }), card('p2', null), card('p3', null)));
  await putLayers(await createPage('product', { store: { kind: 'product' } }), body(element('detail', 'productDetail', { store: { productDetail: { product: null } } })));
  await publish(owner);
});

test.afterAll(async () => {
  await servicesDown([]);
  if (site) await owner.delete(`/ycode/api/platform/sites/${site.id}`);
  await owner?.dispose();
});

// ---------------------------------------------------------------------------
// Category cards (OPEN_QUESTIONS 55)
// ---------------------------------------------------------------------------

test('the category cards show each category the site sells from with its first product\'s picture, a placeholder tile when it has none, and no card for an empty category', async ({ browser }) => {
  const context = await visitor(browser);
  try {
    const page = await context.newPage();
    expect((await page.goto('/'))?.status()).toBe(200);
    // Clothing, Home and Garden, in the site's order; Toys has no product, so no card.
    await expect(categoryLinks(page).locator('.ws-cat-name')).toHaveText(['Clothing', 'Home', 'Garden']);

    const clothing = categoryLinks(page).nth(0);
    await expect(clothing.locator('img')).toHaveAttribute('src', new RegExp(`/store-media/${IMAGE.shirt}\\?item=${ITEM.shirt}`));
    await expect.poll(() => clothing.locator('img').evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0), 'the picture is served by the site').toBe(true);
    await expect(categoryLinks(page).nth(1).locator('img')).toHaveAttribute('src', new RegExp(`/store-media/${IMAGE.lamp}\\?item=${ITEM.lamp}`));

    // The garden hose has no picture: the tile the product card has, with its label.
    const garden = categoryLinks(page).nth(2);
    await expect(garden.locator('img')).toHaveCount(0);
    await expect(garden.locator('.ws-ph .ws-ph-label')).toHaveText('Category image');

    // The picture is decoration: each link is read by the category's name.
    for (const name of ['Clothing', 'Home', 'Garden']) await expect(categoriesOf(page).getByRole('link', { name, exact: true })).toHaveCount(1);
    await expect(categoriesOf(page)).toHaveAttribute('dir', 'ltr');
    // Three to a row, as the handoff draws them.
    const boxes = await Promise.all([0, 1, 2].map((n) => categoryLinks(page).nth(n).boundingBox()));
    expect(new Set(boxes.map((box) => Math.round(box!.y))).size, 'the three cards are on one row').toBe(1);
  } finally {
    await context.close();
  }
});

test('a category card opens the products page listing that category, with its chip pressed (Task B: "the shop home\'s category cards open the filtered products page")', async ({ browser }) => {
  const context = await visitor(browser);
  try {
    const page = await context.newPage();
    await page.goto('/');
    await expect(categoryLinks(page)).toHaveCount(3);
    await expect(categoryLinks(page).nth(1)).toHaveAttribute('href', `/products?category=${CATEGORY.home}`);
    await categoriesOf(page).getByRole('link', { name: 'Home' }).click();
    await expect(page).toHaveURL(`/products?category=${CATEGORY.home}`);
    await expect(gridCards(page).locator('.ws-card-name')).toHaveText(['Desk lamp']);
    await expect(gridOf(page).getByRole('group', { name: 'Categories' }).getByRole('button', { name: 'Home' })).toHaveAttribute('aria-pressed', 'true');
  } finally {
    await context.close();
  }
});

test('the first paint of the category cards is their skeleton, with the status for a screen reader', async ({ browser }) => {
  const context = await visitor(browser);
  try {
    const page = await context.newPage();
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    await page.route('**/ycode/api/store/categories', async (route) => {
      await held;
      await route.continue();
    });
    await page.goto('/');
    await expect(categoriesOf(page).locator('.ws-sk-media')).toHaveCount(3);
    await expect(categoriesOf(page).getByRole('status')).toHaveText('Loading the categories…');
    release();
    await expect(categoryLinks(page)).toHaveCount(3);
    await expect(categoriesOf(page).locator('.ws-sk')).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test('an Arabic page reads the categories in Arabic, right to left, and links under /ar', async ({ browser }) => {
  const context = await visitor(browser);
  try {
    const page = await context.newPage();
    await page.goto('/ar');
    await expect(categoryLinks(page).locator('.ws-cat-name')).toHaveText(['ملابس', 'المنزل', 'الحديقة']);
    await expect(categoriesOf(page)).toHaveAttribute('dir', 'rtl');
    await expect(categoryLinks(page).nth(0)).toHaveAttribute('href', `/ar/products?category=${CATEGORY.clothing}`);
    await expect(categoryLinks(page).nth(2).locator('.ws-ph-label')).toHaveText('صورة القسم');
    // The first card sits at the right edge of the row.
    const [first, last] = [await categoryLinks(page).nth(0).boundingBox(), await categoryLinks(page).nth(2).boundingBox()];
    expect(first!.x).toBeGreaterThan(last!.x);
  } finally {
    await context.close();
  }
});

test('with Product & Services down the category cards show the failure state, and "Try again" shows them once it is back', async ({ browser }) => {
  const context = await visitor(browser);
  try {
    const page = await context.newPage();
    await servicesDown(['product-services']);
    await forgetCatalogue();
    await page.goto('/');
    const alert = categoriesOf(page).getByRole('alert');
    await expect(alert).toContainText('We couldn’t load the products');
    await expect(categoryLinks(page)).toHaveCount(0);

    await servicesDown([]);
    await alert.getByRole('button', { name: 'Try again' }).click();
    await expect(categoryLinks(page)).toHaveCount(3);
    await expect(categoriesOf(page).getByRole('alert')).toHaveCount(0);
  } finally {
    await servicesDown([]);
    await context.close();
  }
});

// ---------------------------------------------------------------------------
// The grid's count (OPEN_QUESTIONS 57)
// ---------------------------------------------------------------------------

test('a grid that shows its count says how many products it lists, and keeps saying it over an empty category and a search with no results', async ({ browser }) => {
  const context = await visitor(browser);
  try {
    const page = await context.newPage();
    await page.goto('/products');
    await expect(gridCards(page)).toHaveCount(3);
    await expect(countOf(page)).toHaveText('3 products');
    // The count is the grid's first line, above the search and the chips.
    const [count, toolbar] = [await countOf(page).boundingBox(), await gridOf(page).locator('.ws-toolbar').boundingBox()];
    expect(count!.y + count!.height).toBeLessThanOrEqual(toolbar!.y);

    const chips = gridOf(page).getByRole('group', { name: 'Categories' });
    await chips.getByRole('button', { name: 'Toys' }).click();
    await expect(gridOf(page).getByRole('heading', { name: 'No products in “Toys” yet' })).toBeVisible();
    await expect(countOf(page)).toHaveText('3 products');

    await chips.getByRole('button', { name: 'All' }).click();
    await gridOf(page).getByRole('searchbox').fill('wool shirt');
    await expect(gridOf(page).getByRole('heading', { name: 'No results for “wool shirt”' })).toBeVisible();
    await expect(countOf(page)).toHaveText('3 products');
  } finally {
    await context.close();
  }
});

test('a products page opened on a category still counts everything the grid lists, and the count\'s line is there before the count', async ({ browser }) => {
  const context = await visitor(browser);
  try {
    const page = await context.newPage();
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    await page.route('**/ycode/api/store/products?*', async (route) => {
      await held;
      await route.continue();
    });
    await page.goto(`/products?category=${CATEGORY.home}`);
    // Nothing is known yet: the line holds its place, empty, so the chips and cards do not move when the count comes.
    await expect(gridOf(page).locator('.ws-sk-media').first()).toBeVisible();
    await expect(countOf(page)).toHaveAttribute('aria-hidden', 'true');
    const before = await countOf(page).boundingBox();
    expect(before!.height).toBeGreaterThan(0);
    release();
    await expect(gridCards(page).locator('.ws-card-name')).toHaveText(['Desk lamp']);
    await expect(countOf(page)).toHaveText('3 products');
    await expect(countOf(page)).not.toHaveAttribute('aria-hidden', /.*/);
    expect((await countOf(page).boundingBox())!.height).toBe(before!.height);
  } finally {
    await context.close();
  }
});

test('the Arabic count is the invariant singular after the number, and a grid that was not asked for a count draws none', async ({ browser }) => {
  const context = await visitor(browser);
  try {
    const page = await context.newPage();
    await page.goto('/ar/products');
    await expect(gridCards(page)).toHaveCount(3);
    await expect(countOf(page)).toHaveText('3 منتج');

    await page.goto('/uncounted');
    await expect(gridCards(page)).toHaveCount(3);
    await expect(countOf(page)).toHaveCount(0);
  } finally {
    await context.close();
  }
});

// ---------------------------------------------------------------------------
// Featured products with nothing picked (OPEN_QUESTIONS 58)
// ---------------------------------------------------------------------------

test('four cards with nothing picked show the store\'s first products, one each, from one request; the card with none left takes no room', async ({ browser }) => {
  const context = await visitor(browser);
  try {
    const page = await context.newPage();
    const asked: string[] = [];
    page.on('request', (req) => {
      const url = new URL(req.url());
      if (url.pathname === '/ycode/api/store/products') asked.push(url.search);
    });
    await page.goto('/');
    // The store sells three products; the grid's order is by name.
    await expect(loneCards(page).locator('.ws-card-name')).toHaveText(['Desk lamp', 'Garden hose', 'Linen shirt']);
    await expect(loneCards(page)).toHaveCount(4);
    await expect(loneCards(page).nth(3)).toBeHidden();
    expect(await loneCards(page).nth(3).evaluate((el) => getComputedStyle(el).display)).toBe('none');
    await expect(loneCards(page).locator('.ws-sk')).toHaveCount(0);
    expect(asked, 'the four cards share one request for four products').toEqual(['?page=1&page_size=4']);

    // They are cards like any other: the lamp is added to the cart, the shirt opens its page.
    await expect(loneCards(page).nth(0).getByRole('button', { name: 'Add to cart' })).toBeVisible();
    await expect(loneCards(page).nth(2).getByRole('link', { name: 'Choose options' })).toHaveAttribute('href', `/product/${ITEM.shirt}`);
  } finally {
    await context.close();
  }
});

test('a picked card still shows its pick, and the unpicked cards beside it leave that product out', async ({ browser }) => {
  const context = await visitor(browser);
  try {
    const page = await context.newPage();
    await page.goto('/picked');
    // The owner picked the hose for the first card; the other two show the lamp and the shirt, never the hose again.
    await expect(loneCards(page).locator('.ws-card-name')).toHaveText(['Garden hose', 'Desk lamp', 'Linen shirt']);
  } finally {
    await context.close();
  }
});

test('with selling off the category cards and the unpicked cards render nothing; switched on again they are back', async ({ browser }) => {
  const context = await visitor(browser);
  try {
    const page = await context.newPage();
    await patchStore({ selling: false });
    await page.goto('/');
    await expect(categoriesOf(page).locator('.ws-cats')).toHaveCount(0);
    await expect(loneCards(page).locator('article')).toHaveCount(0);
    await expect(loneCards(page).locator('.ws-sk')).toHaveCount(0);
    for (const n of [0, 1, 2, 3]) await expect(loneCards(page).nth(n)).toBeHidden();

    await patchStore({ selling: true });
    await page.goto('/');
    await expect(categoryLinks(page)).toHaveCount(3);
    await expect(loneCards(page).locator('article')).toHaveCount(3);
  } finally {
    await patchStore({ selling: true });
    await context.close();
  }
});

// ---------------------------------------------------------------------------
// The product page's breadcrumb (OPEN_QUESTIONS 56)
// ---------------------------------------------------------------------------

test('the product page draws its breadcrumb: Products, the item\'s category, the product; the category opens the products page listing it', async ({ browser }) => {
  const context = await visitor(browser);
  try {
    const page = await context.newPage();
    expect((await page.goto(`/product/${ITEM.shirt}`))?.status()).toBe(200);
    const crumbs = crumbsOf(page);
    await expect(crumbs.getByRole('link')).toHaveText(['Products', 'Shirts']);
    await expect(crumbs.getByRole('link', { name: 'Products' })).toHaveAttribute('href', '/products');
    await expect(crumbs.getByRole('link', { name: 'Shirts' })).toHaveAttribute('href', `/products?category=${CATEGORY.shirts}`);
    await expect(crumbs.locator('[aria-current="page"]')).toHaveText('Linen shirt');
    // Above the product, as the handoff draws it.
    const [crumbsBox, title] = [await crumbs.boundingBox(), await page.locator('[data-ws-store="productDetail"] .ws-pd-title').boundingBox()];
    expect(crumbsBox!.y + crumbsBox!.height).toBeLessThanOrEqual(title!.y);

    await crumbs.getByRole('link', { name: 'Shirts' }).click();
    await expect(page).toHaveURL(`/products?category=${CATEGORY.shirts}`);
    await expect(gridCards(page).locator('.ws-card-name')).toHaveText(['Linen shirt']);
  } finally {
    await context.close();
  }
});

test('the breadcrumb is in the page\'s language, its chevrons turned round on a right to left page', async ({ browser }) => {
  const context = await visitor(browser);
  try {
    const page = await context.newPage();
    await page.goto(`/ar/product/${ITEM.lamp}`);
    const crumbs = page.locator('[data-ws-store="productDetail"]').getByRole('navigation', { name: 'مسار التصفح' });
    await expect(crumbs.getByRole('link')).toHaveText(['المنتجات', 'المنزل']);
    await expect(crumbs.getByRole('link', { name: 'المنزل' })).toHaveAttribute('href', `/ar/products?category=${CATEGORY.home}`);
    await expect(crumbs.locator('[aria-current="page"]')).toHaveText('مصباح مكتب');
    expect(await crumbs.locator('svg').first().evaluate((svg) => getComputedStyle(svg).transform)).toBe('matrix(-1, 0, 0, 1, 0, 0)');
  } finally {
    await context.close();
  }
});

// ---------------------------------------------------------------------------
// The builder
// ---------------------------------------------------------------------------

test('the Store category lists the category cards, and the Layouts tab the "Shop by category" section with its preview', async ({ browser }) => {
  const context = await browser.newContext({ baseURL, storageState: await owner.storageState(), viewport: { width: 1600, height: 1000 } });
  try {
    const page = await context.newPage();
    await page.goto(`/ycode/api/platform/sites/${site.id}/open`);
    await expect(page.getByRole('tab', { name: 'Pages' })).toBeVisible({ timeout: 60_000 });
    await page.getByRole('tab', { name: 'Layers' }).click();
    await page.getByRole('tabpanel', { name: 'Layers' }).getByText('Layers', { exact: true }).locator('xpath=following::button[1]').click();
    await expect(page.getByRole('tabpanel', { name: 'Elements' }).getByText('Category cards', { exact: true })).toBeVisible();

    await page.getByRole('tab', { name: 'Layouts' }).click();
    const layouts = page.getByRole('tabpanel', { name: 'Layouts' });
    await layouts.getByText('Store', { exact: true }).click();
    const preview = layouts.locator('img[src*="store-shop-by-category"]');
    await expect(preview).toBeVisible();
    await expect.poll(() => preview.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
  } finally {
    await context.close();
  }
});

test('the builder canvas draws the category cards, the count and the breadcrumb with sample data and never asks the store API', async ({ browser }) => {
  const samples = await createPage(`samples-${RUN}`);
  await putLayers(samples, body(element('s-cats', 'categoryCards'), grid('s-grid', { showCount: true }), element('s-detail', 'productDetail', { store: { productDetail: { product: null } } })));
  const context = await browser.newContext({ baseURL, storageState: await owner.storageState(), viewport: { width: 1600, height: 1000 } });
  try {
    const page = await context.newPage();
    const storeCalls: string[] = [];
    page.on('request', (req) => {
      const { pathname } = new URL(req.url());
      if (/^\/ycode\/api\/store\/(products|categories|settings)/.test(pathname) || pathname.startsWith('/store-media/')) storeCalls.push(`${req.method()} ${pathname}`);
    });
    await page.goto(`/ycode/api/platform/sites/${site.id}/open`);
    await expect(page.getByRole('tab', { name: 'Pages' })).toBeVisible({ timeout: 60_000 });
    await page.getByRole('tab', { name: 'Pages' }).click();
    await page.getByText(`samples-${RUN}`, { exact: true }).first().click();

    const canvas = page.frameLocator('iframe').first();
    // The handoff's three categories, each a placeholder tile.
    const cats = canvas.locator('[data-ws-store="categoryCards"]');
    await expect(cats.locator('.ws-cat-name')).toHaveText(['Men', 'Women', 'Accessories'], { timeout: 60_000 });
    await expect(cats.locator('.ws-ph-label')).toHaveText(['Category image', 'Category image', 'Category image']);
    await expect(canvas.locator('[data-ws-store="productGrid"] .ws-count')).toHaveText('8 products');
    const crumbs = canvas.locator('[data-ws-store="productDetail"] .ws-crumbs');
    await expect(crumbs.locator('a.ws-crumb')).toHaveText(['Products', 'Men']);
    await expect(crumbs.locator('[aria-current="page"]')).toHaveText('Cotton T-shirt');

    // The grid's settings offer the count.
    await canvas.locator('[data-ws-store="productGrid"]').first().click({ position: { x: 4, y: 4 } });
    await page.getByRole('tab', { name: 'Settings' }).click();
    await expect(page.getByText('Show product count')).toBeVisible();
    await page.waitForTimeout(1500);
    expect(storeCalls, 'the canvas never calls the store API or asks for a product image').toEqual([]);
  } finally {
    await context.close();
  }
});
