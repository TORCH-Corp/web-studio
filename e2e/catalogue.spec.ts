/**
 * Part 2, session W2 "done when": a published site reads its catalogue, and
 * only when it sells.
 *
 * The anonymous store API on a site's own host (`x-forwarded-host`, as nginx
 * forwards it), with the platform stub (e2e/platform-stub.ts) standing in for
 * Product & Services and Organization Setup and the fake Document Center
 * holding the item images. The catalogue organization of e2e/platform-fixtures.ts
 * has two plain items (one priced 0), a shirt with four variants (discontinued,
 * no price, priced in USD, priced in IQD), an item in a category the site does
 * not sell from, one whose channel is off, an inactive one, two images and a
 * document that is no item's image.
 *
 * A change to the store settings forgets the site's 60-second catalogue, which
 * is how the specs make the next read ask the services again.
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, request, test, type APIRequestContext } from '@playwright/test';
import { createSite, openSite, signIn, type SiteRecord } from './helpers';
import { BRANCH, CATALOGUE_ORG, CATEGORY, DOCUMENTS, IMAGE, ITEM, OPTION, SPEC } from './platform-fixtures';

test.describe.configure({ mode: 'serial' });

const RUN = Date.now().toString(36);
const PORT = Number(process.env.E2E_PORT || 3102);
const PLATFORM = `http://127.0.0.1:${Number(process.env.E2E_PLATFORM_PORT || PORT + 3)}`;
const DOCUMENT_CENTER = `http://127.0.0.1:${Number(process.env.E2E_DC_PORT || PORT + 2)}`;
/** Where the app keeps item images (PLATFORM_STORAGE_DIR of playwright.config.ts, then `_store-media`). */
const MEDIA_DIR = path.join(os.tmpdir(), `web-studio-e2e-storage-${PORT}`, '_store-media', CATALOGUE_ORG);
const OWNER = { sub: '45454545-4545-4545-8545-454545454545', email: 'owner-catalogue@example.com', name: 'Catalogue Owner', org: CATALOGUE_ORG };

const STORE_ROUTES = ['/ycode/api/store/products', `/ycode/api/store/products/${ITEM.lamp}`, '/ycode/api/store/categories', '/ycode/api/store/settings'];
const media = (document: string, item: string) => `/store-media/${document}?item=${item}`;
const PIECE = { name: 'Piece', symbol: 'pcs' };

let baseURL: string;
let owner: APIRequestContext;
let visitor: APIRequestContext;
let site: SiteRecord;
let fee = 1000;

async function control(url: string, data: unknown): Promise<void> {
  const context = await request.newContext();
  try {
    expect((await context.post(url, { data })).status()).toBe(200);
  } finally {
    await context.dispose();
  }
}
const servicesDown = (services: Array<'org-setup' | 'product-services'>) => control(`${PLATFORM}/__down`, { services });
const rate = (found: boolean) => control(`${PLATFORM}/__rate`, { found });

async function hits(document: string): Promise<{ downloads: number; reads: number }> {
  const context = await request.newContext();
  try {
    return (await (await context.get(`${DOCUMENT_CENTER}/__hits?document=${document}`)).json()) as { downloads: number; reads: number };
  } finally {
    await context.dispose();
  }
}

async function patchStore(data: Record<string, unknown>): Promise<void> {
  const response = await owner.patch(`/ycode/api/platform/sites/${site.id}/store`, { data });
  expect(response.status(), await response.text()).toBe(200);
}
/** Any change to the store settings: the next store read asks the services again. */
const forgetCatalogue = () => patchStore({ delivery_fee: (fee += 250) });

async function readJson(path: string) {
  const response = await visitor.get(path);
  expect(response.status(), await response.text()).toBe(200);
  return response.json();
}

test.beforeAll(async ({ baseURL: configured }) => {
  baseURL = configured!;
  await servicesDown([]);
  await rate(true);
  await fs.rm(MEDIA_DIR, { recursive: true, force: true });
  owner = await signIn(baseURL, OWNER);
  site = await createSite(owner, { name: 'Mansour Store', slug: `shop-${RUN}`, languages: ['ar', 'en'], default_language: 'ar' });
  expect(site.hosts[0]).toBe(`shop-${RUN}.sites.test`);
  visitor = await request.newContext({ baseURL, extraHTTPHeaders: { 'x-forwarded-host': site.hosts[0] } });
  await patchStore({ branch_id: BRANCH.catalogue, category_ids: [CATEGORY.clothing, CATEGORY.home], delivery_fee: 2500, selling: true });
});

test.afterAll(async () => {
  await servicesDown([]);
  await rate(true);
  await visitor?.dispose();
  await owner?.dispose();
});

test('the public prefix: /studio/api answers as /ycode/api does, with the same checks, and nothing else lives under /studio', async () => {
  const byOldPath = await readJson('/ycode/api/store/products');
  const byPublicPath = await readJson('/studio/api/store/products');
  expect(byPublicPath).toEqual(byOldPath);

  // A route that needs a session refuses a visitor on both paths.
  expect((await visitor.get('/ycode/api/pages')).status()).toBe(401);
  expect((await visitor.get('/studio/api/pages')).status()).toBe(401);
  // A path no route names is not found on both.
  expect((await visitor.get('/studio/api/no-such-route')).status()).toBe(404);
  // The layouts' assets answer under the public prefix.
  expect((await visitor.get('/studio/layouts/assets/company-1-logo-black.svg')).status()).toBe(200);
  // Builder screens are not aliased, and /studio is never a site's page.
  expect((await visitor.get('/studio')).status()).toBe(404);
  expect((await visitor.get('/studio/settings/general')).status()).toBe(404);
});

test('the products route lists the priced plain item and the shirt as one product "from" its lowest variant, and nothing else', async () => {
  const body = await readJson('/ycode/api/store/products');
  expect(body.meta).toEqual({ page: 1, page_size: 12, total: 2 });
  expect(body.data.map((p: { id: string }) => p.id)).toEqual([ITEM.lamp, ITEM.shirt]);
  const [lamp, shirt] = body.data;
  expect(lamp).toEqual({
    id: ITEM.lamp,
    sku: 'LMP-001',
    name: 'Desk lamp',
    name_ar: 'مصباح مكتب',
    description: 'A brass desk lamp.',
    description_ar: 'مصباح مكتب نحاسي.',
    price: { amount: '25000', currency: 'IQD', converted: false, from: false },
    unit: PIECE,
    images: [{ document_id: IMAGE.lamp, url: media(IMAGE.lamp, ITEM.lamp) }],
    category: { id: CATEGORY.home, name: 'Home', name_ar: 'المنزل' },
    variants: [],
    axes_summary: [],
  });
  // The cheapest variant that can be bought is the USD one, at 20 × 1520.
  expect(shirt.price).toEqual({ amount: '30400', currency: 'IQD', converted: true, from: true });
  expect(shirt.category).toEqual({ id: CATEGORY.shirts, name: 'Shirts', name_ar: 'قمصان' });
  // Never the 0-priced item, a variant's own row (the USD child has a channel row of its own), the out-of-category
  // item, an item whose channel is off, an inactive one, and nothing internal of Product & Services.
  const text = JSON.stringify(body);
  for (const id of [ITEM.sample, ITEM.hose, ITEM.chair, ITEM.oldLamp]) expect(text).not.toContain(id);
  expect(body.data.map((p: { id: string }) => p.id)).not.toContain(ITEM.shirtSmallBlue);
  expect(text).not.toContain('initial_cost');
});

test('the product route shows the four variants, two unavailable (discontinued, no price), the USD one converted at the stub\'s rate', async () => {
  const { data: shirt } = await readJson(`/ycode/api/store/products/${ITEM.shirt}`);
  expect(shirt).toMatchObject({ id: ITEM.shirt, sku: 'SHT-001', name: 'Linen shirt', name_ar: 'قميص كتان', unit: PIECE });
  expect(shirt.images).toEqual([{ document_id: IMAGE.shirt, url: media(IMAGE.shirt, ITEM.shirt) }]);
  expect(shirt.variants.map((v: { id: string; available: boolean; unavailable_reason: string | null; price: unknown }) => [v.id, v.available, v.unavailable_reason, v.price])).toEqual([
    [ITEM.shirtMediumWhite, false, 'inactive', null],
    [ITEM.shirtLargeWhite, false, 'no_price', null],
    [ITEM.shirtSmallBlue, true, null, { amount: '30400', currency: 'IQD', converted: true }],
    [ITEM.shirtSmallWhite, true, null, { amount: '35000', currency: 'IQD', converted: false }],
  ]);
  const blue = shirt.variants[2];
  expect(blue.sku).toBe('SHT-001-S-BLU');
  expect(blue.axes).toEqual([
    { specification_id: SPEC.size, option_id: OPTION.s, name: 'Size', name_ar: 'المقاس', option: 'Small', option_ar: 'صغير' },
    { specification_id: SPEC.colour, option_id: OPTION.blue, name: 'Colour', name_ar: 'اللون', option: 'Blue', option_ar: 'أزرق' },
  ]);
  // No variant has an image of its own: each shows the shirt's (decision 16f).
  expect(new Set(shirt.variants.map((v: { image: unknown }) => JSON.stringify(v.image)))).toEqual(new Set([JSON.stringify({ document_id: IMAGE.shirt, url: media(IMAGE.shirt, ITEM.shirt) })]));
  expect(shirt.axes_summary).toEqual([
    { id: SPEC.size, code: 'SZ', name: 'Size', name_ar: 'المقاس', options: [
      { id: OPTION.s, code: 'S', label: 'Small', label_ar: 'صغير' },
      { id: OPTION.m, code: 'M', label: 'Medium', label_ar: 'وسط' },
      { id: OPTION.l, code: 'L', label: 'Large', label_ar: 'كبير' },
    ] },
    { id: SPEC.colour, code: 'CLR', name: 'Colour', name_ar: 'اللون', options: [
      { id: OPTION.white, code: 'WHT', label: 'White', label_ar: 'أبيض' },
      { id: OPTION.blue, code: 'BLU', label: 'Blue', label_ar: 'أزرق' },
    ] },
  ]);

  // Not on sale here: a variant's own id, the 0-priced item, the item outside the site's categories, an unknown or malformed id.
  for (const id of [ITEM.shirtSmallBlue, ITEM.sample, ITEM.hose, '48484848-9999-4848-8848-484848484848', 'lamp']) {
    const response = await visitor.get(`/ycode/api/store/products/${id}`);
    expect(response.status(), id).toBe(404);
    expect((await response.json()).code).toBe('product_not_found');
  }
});

test('the grid filters by category (with what is under it) and by name in either language, pages, and refuses a bad query', async () => {
  const ids = async (query: string) => (await readJson(`/ycode/api/store/products?${query}`)).data.map((p: { id: string }) => p.id);
  expect(await ids(`category=${CATEGORY.clothing}`)).toEqual([ITEM.shirt]);
  expect(await ids(`category=${CATEGORY.home}`)).toEqual([ITEM.lamp]);
  expect(await ids(`category=${CATEGORY.garden}`)).toEqual([]);
  expect(await ids('q=LAMP')).toEqual([ITEM.lamp]);
  expect(await ids(`q=${encodeURIComponent('قميص')}`)).toEqual([ITEM.shirt]);
  const second = await readJson('/ycode/api/store/products?page=2&page_size=1');
  expect([second.data.map((p: { id: string }) => p.id), second.meta]).toEqual([[ITEM.shirt], { page: 2, page_size: 1, total: 2 }]);
  expect((await readJson('/ycode/api/store/products?page=3&page_size=1')).data).toEqual([]);
  const refused = await visitor.get('/ycode/api/store/products?page_size=49&category=garden');
  expect(refused.status()).toBe(400);
  expect(await refused.json()).toMatchObject({ code: 'invalid_query', details: ['page_size must be a whole number from 1 to 48', 'category must be a category id'] });
});

test('the shop home\'s categories carry what the site sells in each and the first product\'s image', async () => {
  expect((await readJson('/ycode/api/store/categories')).data).toEqual([
    { id: CATEGORY.clothing, name: 'Clothing', name_ar: 'ملابس', item_count: 1, first_product_image: media(IMAGE.shirt, ITEM.shirt) },
    { id: CATEGORY.home, name: 'Home', name_ar: 'المنزل', item_count: 1, first_product_image: media(IMAGE.lamp, ITEM.lamp) },
  ]);
});

test('the public settings say the store sells, in which currency, at which fee', async () => {
  expect((await readJson('/ycode/api/store/settings')).data).toEqual({ selling: true, currency: 'IQD', delivery_fee: '2500.00' });
});

test('an image is fetched from Document Center once and served from the site\'s own copy after that', async () => {
  const seeded = Buffer.from(DOCUMENTS.find((d) => d.id === IMAGE.shirt)!.base64, 'base64');
  // Counted from here: outside CI a fake Document Center left running by an earlier run is reused.
  const before = await hits(IMAGE.shirt);
  const first = await visitor.get(media(IMAGE.shirt, ITEM.shirt));
  expect(first.status()).toBe(200);
  expect(Buffer.from(await first.body())).toEqual(seeded);
  expect(first.headers()['content-type']).toBe('image/png');
  expect(first.headers()['cache-control']).toBe('public, max-age=86400');
  expect(first.headers()['x-content-type-options']).toBe('nosniff');
  const etag = first.headers().etag;
  expect(etag).toMatch(/^"[0-9a-f]{64}"$/);

  const second = await visitor.get(media(IMAGE.shirt, ITEM.shirt));
  expect(second.status()).toBe(200);
  expect(Buffer.from(await second.body())).toEqual(seeded);
  expect((await visitor.get(media(IMAGE.shirt, ITEM.shirt), { headers: { 'if-none-match': etag } })).status()).toBe(304);
  const after = await hits(IMAGE.shirt);
  expect([after.downloads - before.downloads, after.reads - before.reads]).toEqual([1, 0]);
});

test('no other document of the organization comes out through the site: not another product\'s image, not a contract', async () => {
  const [contract, lamp] = [await hits(IMAGE.contract), await hits(IMAGE.lamp)];
  for (const url of [
    media(IMAGE.contract, ITEM.lamp),
    media(IMAGE.lamp, ITEM.shirt),
    media(IMAGE.lamp, ITEM.hose),
    media(IMAGE.lamp, ITEM.sample),
    `/store-media/${IMAGE.lamp}`,
    '/store-media/not-a-document?item=x',
  ]) {
    expect((await visitor.get(url)).status(), url).toBe(404);
  }
  expect(await hits(IMAGE.contract)).toEqual(contract);
  expect(await hits(IMAGE.lamp)).toEqual(lamp);
});

test('with no rate for the day the USD variant is unavailable and the shirt is "from" its IQD variant', async () => {
  await rate(false);
  await forgetCatalogue();
  const { data: shirt } = await readJson(`/ycode/api/store/products/${ITEM.shirt}`);
  const blue = shirt.variants.find((v: { id: string }) => v.id === ITEM.shirtSmallBlue);
  expect([blue.available, blue.unavailable_reason, blue.price]).toEqual([false, 'no_rate', null]);
  expect(shirt.price).toEqual({ amount: '35000', currency: 'IQD', converted: false, from: true });
  const list = await readJson('/ycode/api/store/products');
  expect(list.data.map((p: { id: string }) => p.id)).toEqual([ITEM.lamp, ITEM.shirt]);
  await rate(true);
  await forgetCatalogue();
});

test('the catalogue is kept 60 seconds: a service that goes down meanwhile is not asked', async () => {
  await readJson('/ycode/api/store/products');
  await readJson(`/ycode/api/store/products/${ITEM.lamp}`); // the lamp's images, read once with the catalogue they belong to
  await servicesDown(['product-services', 'org-setup']);
  try {
    expect((await readJson('/ycode/api/store/products')).meta.total).toBe(2);
    expect((await readJson(`/ycode/api/store/products/${ITEM.lamp}`)).data.id).toBe(ITEM.lamp);
  } finally {
    await servicesDown([]);
  }
});

test('Product & Services or Organization Setup that cannot be asked answers 503 with a code; nothing failed is kept', async () => {
  await servicesDown(['product-services']);
  try {
    await forgetCatalogue();
    for (const route of ['/ycode/api/store/products', `/ycode/api/store/products/${ITEM.lamp}`, '/ycode/api/store/categories']) {
      const response = await visitor.get(route);
      expect(response.status(), route).toBe(503);
      expect((await response.json()).code, route).toBe('product_services_unavailable');
    }
    await servicesDown(['org-setup']);
    const response = await visitor.get('/ycode/api/store/products');
    expect(response.status()).toBe(503);
    expect((await response.json()).code).toBe('org_setup_unavailable');
  } finally {
    await servicesDown([]);
  }
  expect((await readJson('/ycode/api/store/products')).meta.total).toBe(2);
});

test('with selling off every store route answers 404, the images too', async () => {
  await patchStore({ selling: false });
  try {
    for (const route of [...STORE_ROUTES, media(IMAGE.shirt, ITEM.shirt)]) {
      expect((await visitor.get(route)).status(), route).toBe(404);
    }
    expect((await (await visitor.get('/ycode/api/store/products')).json()).code).toBe('store_not_found');
  } finally {
    await patchStore({ selling: true });
  }
  expect((await visitor.get('/ycode/api/store/settings')).status()).toBe(200);
});

test('on the builder host every store route answers 404, even for a user who has the selling site open', async () => {
  const opened = await openSite(owner, site.id);
  expect(opened.status()).toBe(303);
  const anonymous = await request.newContext({ baseURL });
  try {
    for (const route of [...STORE_ROUTES, media(IMAGE.shirt, ITEM.shirt)]) {
      expect((await owner.get(route)).status(), `${route} with the site open`).toBe(404);
      expect((await anonymous.get(route)).status(), route).toBe(404);
    }
  } finally {
    await anonymous.dispose();
  }
  // Another site's host does not see this one's store.
  const elsewhere = await request.newContext({ baseURL, extraHTTPHeaders: { 'x-forwarded-host': `nobody-${RUN}.sites.test` } });
  try {
    expect((await elsewhere.get('/ycode/api/store/products')).status()).toBe(404);
  } finally {
    await elsewhere.dispose();
  }
});
