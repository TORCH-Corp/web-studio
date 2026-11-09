/**
 * What a product page says about itself, and the sitemap (part 2 release fixes,
 * OPEN_QUESTIONS 45).
 *
 * A published product page's title is "{product name} · {site name}" and its
 * description the product's, its first 160 characters, in the page's language,
 * where the page's own SEO fields are empty; a field the page fills stays the
 * page's; the canonical address names the item. `sitemap.xml` lists each product
 * the store sells in each language and leaves out the page's bare address, which
 * keeps answering 404.
 *
 * Each case that sets a page's own SEO fields has a site of its own, published
 * with them before its first request: the product page's data lives 60 seconds
 * per item address (a publish purges the page's own route, not the item's), so a
 * page read before and after a change would still be the old one.
 */

import { expect, request, test, type APIRequestContext } from '@playwright/test';
import { createSite, draftPages, openSite, publish, publishedSite, signIn, type SiteRecord } from './helpers';
import { BRANCH, CATALOGUE_ORG, CATEGORY, ITEM } from './platform-fixtures';

test.describe.configure({ mode: 'serial' });

const RUN = Date.now().toString(36);
const PORT = Number(process.env.E2E_PORT || 3102);
const PLATFORM = `http://127.0.0.1:${Number(process.env.E2E_PLATFORM_PORT || PORT + 3)}`;
const OWNER = { sub: '7a7a7a7a-7a7a-47a7-87a7-7a7a7a7a7a7a', email: 'owner-product-seo@example.com', name: 'Product SEO Owner', org: CATALOGUE_ORG };
const CATEGORIES = [CATEGORY.clothing, CATEGORY.home, CATEGORY.toys];

let baseURL: string;
let owner: APIRequestContext;
let fee = 5000;

interface Store {
  site: SiteRecord;
  host: string;
}
let plain: Store;
/** The sites the cases after the first make, deleted at the end. */
const created: Store[] = [];

const detail = { id: 'detail', name: 'productDetail', classes: 'w-full', settings: { tag: 'div', store: { productDetail: { product: null } } }, children: [] };
const body = (...children: unknown[]) => [{ id: 'body', name: 'body', classes: '', children }];

async function control(url: string, data: unknown): Promise<void> {
  const context = await request.newContext();
  try {
    expect((await context.post(url, { data })).status()).toBe(200);
  } finally {
    await context.dispose();
  }
}

async function patchStore(store: Store, data: Record<string, unknown>): Promise<void> {
  const response = await owner.patch(`/ycode/api/platform/sites/${store.site.id}/store`, { data });
  expect(response.status(), await response.text()).toBe(200);
}
/** Any change to the store settings makes the next store read ask the stubs again (catalogue.spec.ts). */
const forgetCatalogue = (store: Store) => patchStore(store, { delivery_fee: (fee += 250) });

/**
 * A selling site called "Product Store", English by default with Arabic, whose product page (the page `products`) has the
 * given SEO fields of its own, published once: its first request comes after its publish.
 */
async function storeWith(slug: string, seo?: { title?: string; description?: string }): Promise<Store> {
  const site = await createSite(owner, { name: 'Product Store', slug: `${slug}-${RUN}`, languages: ['en', 'ar'], default_language: 'en' });
  expect((await openSite(owner, site.id)).status()).toBe(303);
  await patchStore({ site, host: site.hosts[0] }, { branch_id: BRANCH.catalogue, category_ids: CATEGORIES, delivery_fee: fee, selling: true });
  const home = (await draftPages(owner)).find((page) => page.is_index)!;
  const put = async (pageId: string, layers: unknown[]) => {
    const response = await owner.put(`/ycode/api/layers?page_id=${pageId}`, { data: { layers } });
    expect(response.status(), await response.text()).toBe(200);
  };
  await put(home.id, body());
  const created = await owner.post('/ycode/api/pages', { data: { name: 'products', slug: 'products', settings: { store: { kind: 'product' }, ...(seo ? { seo } : {}) } } });
  expect(created.status() < 300, await created.text()).toBe(true);
  await put((await created.json()).data.id, body(detail));
  const landing = await owner.post('/ycode/api/pages', { data: { name: 'landing', slug: 'landing', settings: {} } });
  expect(landing.status() < 300, await landing.text()).toBe(true);
  await put((await landing.json()).data.id, body());
  await publish(owner);
  return { site, host: site.hosts[0] };
}

/** The document head of a published page: the title, the description, the canonical link. */
async function headOf(store: Store, path: string) {
  const anonymous = await publishedSite(baseURL, store.host);
  try {
    const response = await anonymous.get(path);
    expect(response.status(), path).toBe(200);
    const html = await response.text();
    return {
      title: /<title>([^<]*)<\/title>/.exec(html)?.[1],
      description: /<meta name="description" content="([^"]*)"/.exec(html)?.[1],
      canonical: /<link rel="canonical" href="([^"]*)"/.exec(html)?.[1],
    };
  } finally {
    await anonymous.dispose();
  }
}

test.beforeAll(async ({ baseURL: configured }) => {
  baseURL = configured!;
  await control(`${PLATFORM}/__down`, { services: [] });
  await control(`${PLATFORM}/__rate`, { found: true });
  owner = await signIn(baseURL, OWNER);
});

test.afterAll(async () => {
  await control(`${PLATFORM}/__down`, { services: [] });
  for (const store of [plain, ...created]) if (store) await owner.delete(`/ycode/api/platform/sites/${store.site.id}`);
  await owner?.dispose();
});

test('a product page is titled by its product and the site, described by the product, and its canonical address names the item', async () => {
  plain = await storeWith('seo-plain');
  // The page has no SEO fields of its own: the product fills them, in the page's language.
  expect(await headOf(plain, `/products/${ITEM.shirt}`)).toEqual({
    title: 'Linen shirt · Product Store',
    description: 'Washed linen.',
    canonical: expect.stringMatching(new RegExp(`(^|/)products/${ITEM.shirt}$`)),
  });
  expect(await headOf(plain, `/ar/products/${ITEM.shirt}`)).toEqual({
    title: 'قميص كتان · Product Store',
    description: 'كتان مغسول.',
    canonical: expect.stringMatching(new RegExp(`/ar/products/${ITEM.shirt}$`)),
  });
  // Two products, two titles and descriptions: a search result no longer reads the same for both.
  expect(await headOf(plain, `/products/${ITEM.lamp}`)).toMatchObject({ title: 'Desk lamp · Product Store', description: 'A brass desk lamp.' });
  expect(await headOf(plain, `/ar/products/${ITEM.lamp}`)).toMatchObject({ title: 'مصباح مكتب · Product Store', description: 'مصباح مكتب نحاسي.' });
});

test('a field the page fills itself stays the page\'s: its title wins and the description still comes from the product; with both filled both are the page\'s', async () => {
  const titled = await storeWith('seo-title', { title: 'Our shop' });
  const both = await storeWith('seo-both', { title: 'Our shop', description: 'Everything we sell.' });
  created.push(titled, both);
  expect(await headOf(titled, `/products/${ITEM.shirt}`)).toMatchObject({ title: 'Our shop', description: 'Washed linen.' });
  expect(await headOf(both, `/products/${ITEM.shirt}`)).toMatchObject({ title: 'Our shop', description: 'Everything we sell.' });
});

test('sitemap.xml lists each product the store sells in each language, and not the product page\'s bare address, which stays a 404', async () => {
  const anonymous = await publishedSite(baseURL, plain.host);
  const locsOf = async () => [...(await (await anonymous.get('/sitemap.xml')).text()).matchAll(/<loc>([^<]*)<\/loc>/g)].map((match) => match[1]);
  try {
    const response = await anonymous.get('/sitemap.xml');
    expect(response.status(), await response.text()).toBe(200);
    const xml = await response.text();
    const locs = await locsOf();
    // The origin is the request's: plain http here (nginx adds X-Forwarded-Proto https in production).
    const origin = `http://${plain.host}`;
    for (const id of [ITEM.lamp, ITEM.shirt]) {
      expect(locs).toContain(`${origin}/products/${id}`);
      expect(locs).toContain(`${origin}/ar/products/${id}`);
    }
    // An item that is not sold here is not listed, nor is a variant or an item outside the site's categories; the bare address is not, in either language.
    for (const id of [ITEM.chair, ITEM.hose, ITEM.shirtSmallWhite, ITEM.oldLamp]) expect(locs.join('\n')).not.toContain(id);
    expect(locs).not.toContain(`${origin}/products`);
    expect(locs).not.toContain(`${origin}/ar/products`);
    // The site's other pages are still there, and a product carries the same hreflang cluster as they do.
    expect(locs).toContain(`${origin}/landing`);
    expect(xml).toContain(`<xhtml:link rel="alternate" hreflang="ar" href="${origin}/ar/products/${ITEM.shirt}" />`);
    expect(xml).toContain(`<xhtml:link rel="alternate" hreflang="x-default" href="${origin}/products/${ITEM.shirt}" />`);
    // Each product once per language; the bare address answers 404 still.
    expect(locs.filter((loc) => loc === `${origin}/products/${ITEM.shirt}`)).toHaveLength(1);
    expect((await anonymous.get('/products')).status()).toBe(404);

    // A store that does not sell lists no product, and the bare address is still out.
    await patchStore(plain, { selling: false });
    try {
      const closed = await locsOf();
      expect(closed.filter((loc) => loc.includes('/products'))).toEqual([]);
      expect(closed).toContain(`${origin}/landing`);
    } finally {
      await patchStore(plain, { selling: true });
    }

    // With Product & Services down the sitemap is a 503 a crawler retries, not a sitemap without the products.
    await forgetCatalogue(plain);
    await control(`${PLATFORM}/__down`, { services: ['product-services'] });
    try {
      const down = await anonymous.get('/sitemap.xml');
      expect(down.status()).toBe(503);
      expect(down.headers()['retry-after']).toBeTruthy();
    } finally {
      await control(`${PLATFORM}/__down`, { services: [] });
      await forgetCatalogue(plain);
    }
    expect((await anonymous.get('/sitemap.xml')).status()).toBe(200);
  } finally {
    await anonymous.dispose();
  }
});
