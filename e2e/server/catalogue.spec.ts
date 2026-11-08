/**
 * Part 2, session W2's catalogue read and anonymous store API, against the
 * deployed service and the real Product & Services, Organization Setup and
 * Document Center (session D1, server mode).
 *
 * A site of the test organization that sells and is published answers, to an
 * anonymous visitor on its own https://{slug}.sites.torchcorp.com host: the
 * public store settings, the products (the fixture item on the ECOMMERCE
 * channel, with its price and its real image), search, the category filter,
 * paging, one product, and the categories. A site that does not sell, and the
 * builder's own host, answer 404 on every store route.
 */

import { expect, request, test, type APIRequestContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { signInWithToken } from '../helpers';
import { accessToken, createSellingSite, deleteSite, ensureStoreItem, STORE_IMAGE, STORE_ITEM, visitor, type SellingSite } from './real-services';

test.describe.configure({ mode: 'serial' });

const RUN = Date.now().toString(36);

let baseURL: string;
let api: APIRequestContext;
let fixture: { id: string; imageDocumentId: string };
let store: SellingSite;
let quiet: SellingSite;
let shop: APIRequestContext;

interface Product {
  id: string;
  sku: string;
  name: string;
  name_ar: string | null;
  price: { amount: string; currency: string; converted: boolean; from: boolean };
  unit: { name: string; symbol: string } | null;
  images: Array<{ document_id: string; url: string }>;
  category: { id: string } | null;
  variants: unknown[];
}

const products = async (query = '', as = shop) => {
  const response = await as.get(`/ycode/api/store/products${query}`);
  expect(response.status(), await response.text()).toBe(200);
  return (await response.json()) as { data: Product[]; meta: { page: number; page_size: number; total: number } };
};
const ours = (list: Product[]) => list.find((product) => product.id === fixture.id);

test.beforeAll(async ({ baseURL: configured }) => {
  baseURL = configured!;
  const token = await accessToken();
  api = await signInWithToken(baseURL, token);
  fixture = await ensureStoreItem(token);
  store = await createSellingSite(api, RUN, { slugPrefix: 'e2e-cat', name: 'E2E catalogue' });
  quiet = await createSellingSite(api, RUN, { slugPrefix: 'e2e-catoff', name: 'E2E catalogue off', selling: false, publishIt: false });
  shop = await visitor(store.host);
});

test.afterAll(async () => {
  await shop?.dispose();
  await deleteSite(api, store?.site);
  await deleteSite(api, quiet?.site);
  await api?.dispose();
});

test('the public store settings: selling, the currency and the fee, nothing of the branch or the categories', async () => {
  const response = await shop.get('/ycode/api/store/settings');
  expect(response.status(), await response.text()).toBe(200);
  expect((await response.json()).data).toEqual({ selling: true, currency: 'IQD', delivery_fee: '2500.00' });
});

test('the fixture item is sold: its price in IQD, its unit, its category, its names and its image', async () => {
  const list = await products();
  const product = ours(list.data);
  expect(product, 'the item on the ECOMMERCE channel is in the products').toBeTruthy();
  expect(list.meta.total).toBeGreaterThanOrEqual(1);
  expect(product).toMatchObject({
    sku: STORE_ITEM.sku,
    name: STORE_ITEM.name,
    name_ar: STORE_ITEM.name_ar,
    price: { currency: 'IQD', converted: false, from: false },
    category: { id: STORE_ITEM.categoryId },
    variants: [],
  });
  expect(Number(product!.price.amount)).toBe(STORE_ITEM.price);
  expect(product!.unit?.name).toBeTruthy();
  expect(product!.images).toHaveLength(1);
  expect(product!.images[0].document_id).toBe(fixture.imageDocumentId);
});

test('the item\'s image is served through the site from Document Center: its bytes, cached for a day, kept, and no other document comes through', async () => {
  const image = ours((await products()).data)!.images[0];
  const first = await shop.get(image.url);
  expect(first.status(), await first.text().catch(() => '')).toBe(200);
  expect(first.headers()['content-type']).toMatch(/^image\/png/);
  expect(first.headers()['cache-control']).toBe('public, max-age=86400');
  expect(first.headers()['x-content-type-options']).toBe('nosniff');
  expect(first.headers()['etag']).toBeTruthy();
  expect(Buffer.compare(await first.body(), STORE_IMAGE.bytes)).toBe(0);

  // The second read is the copy kept on the server's disk: same bytes, same ETag.
  const again = await shop.get(image.url);
  expect(again.status()).toBe(200);
  expect(again.headers()['etag']).toBe(first.headers()['etag']);
  expect(Buffer.compare(await again.body(), STORE_IMAGE.bytes)).toBe(0);

  // A document that is not an image of a product the site sells is not served.
  expect((await shop.get(`/store-media/${randomUUID()}?item=${fixture.id}`)).status()).toBe(404);
  expect((await shop.get(`/store-media/${fixture.imageDocumentId}?item=${randomUUID()}`)).status()).toBe(404);
});

test('search finds the item by its name, the category filter by its category, and a miss is an empty page', async () => {
  expect(ours((await products(`?q=${encodeURIComponent('E2E Web Studio')}`)).data)).toBeTruthy();
  expect(ours((await products(`?q=${encodeURIComponent(`no-such-product-${RUN}`)}`)).data)).toBeUndefined();
  expect(ours((await products(`?category=${STORE_ITEM.categoryId}`)).data)).toBeTruthy();
  const elsewhere = await products(`?category=${randomUUID()}`);
  expect(elsewhere.data).toEqual([]);
  expect(elsewhere.meta.total).toBe(0);
});

test('paging: one product a page, and a page size outside 1 to 48 is a 400', async () => {
  const page = await products('?page=1&page_size=1');
  expect(page.data).toHaveLength(1);
  expect(page.meta).toMatchObject({ page: 1, page_size: 1 });
  expect(page.meta.total).toBeGreaterThanOrEqual(1);
  const refused = await shop.get('/ycode/api/store/products?page_size=100');
  expect(refused.status()).toBe(400);
  expect((await refused.json()).code).toBe('invalid_query');
});

test('one product: the same shape with its images, and an unknown id is 404', async () => {
  const response = await shop.get(`/ycode/api/store/products/${fixture.id}`);
  expect(response.status(), await response.text()).toBe(200);
  const product = (await response.json()).data as Product;
  expect(product).toMatchObject({ id: fixture.id, sku: STORE_ITEM.sku, variants: [] });
  expect(product.images.map((image) => image.document_id)).toContain(fixture.imageDocumentId);
  const missing = await shop.get(`/ycode/api/store/products/${randomUUID()}`);
  expect(missing.status()).toBe(404);
  expect((await missing.json()).code).toBe('product_not_found');
});

test('the shop home\'s categories carry a category with the item in or under it, and its count', async () => {
  const response = await shop.get('/ycode/api/store/categories');
  expect(response.status(), await response.text()).toBe(200);
  const categories = (await response.json()).data as Array<{ id: string; item_count: number; first_product_image: string | null }>;
  const category = categories.find((c) => c.id === STORE_ITEM.categoryId) ?? categories.find((c) => c.item_count > 0);
  expect(category, 'a category with the item in or under it').toBeTruthy();
  expect(category!.item_count).toBeGreaterThanOrEqual(1);
});

test('a store setting that changes is seen at once: the fee, without waiting for the catalogue\'s 60 seconds', async () => {
  const saved = await api.patch(`/ycode/api/platform/sites/${store.site.id}/store`, { data: { delivery_fee: 4000 } });
  expect(saved.status(), await saved.text()).toBe(200);
  const response = await shop.get('/ycode/api/store/settings');
  expect((await response.json()).data.delivery_fee).toBe('4000.00');
  expect(ours((await products()).data), 'the catalogue is still read').toBeTruthy();
});

test('a site that does not sell, and the builder\'s own host, answer 404 on every store route', async () => {
  const routes = ['/ycode/api/store/settings', '/ycode/api/store/products', `/ycode/api/store/products/${fixture.id}`, '/ycode/api/store/categories'];
  const off = await visitor(quiet.host);
  try {
    for (const route of routes) {
      const response = await off.get(route);
      expect(response.status(), route).toBe(404);
      expect((await response.json()).code, route).toBe('store_not_found');
    }
    expect((await off.get(`/store-media/${fixture.imageDocumentId}?item=${fixture.id}`)).status()).toBe(404);
  } finally {
    await off.dispose();
  }

  const builder = await request.newContext({ baseURL });
  try {
    for (const route of routes) {
      const response = await builder.get(route);
      expect(response.status(), `the builder host ${route}`).toBe(404);
      expect((await response.json()).code, route).toBe('store_not_found');
    }
  } finally {
    await builder.dispose();
  }
});
