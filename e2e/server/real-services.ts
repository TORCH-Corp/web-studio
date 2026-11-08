/**
 * What the server-mode store specs share (part 2, session D1): they run against
 * the deployed Web Studio and its real neighbours (Organization Setup, Product &
 * Services, Contact Center, Sales), with the test account's own organization.
 * Nothing here stubs a service.
 *
 *   - `accessToken`: a real Business OS access token for the test account.
 *   - `ensureStoreItem` / `retireStoreItem`: ONE persistent test item on the
 *     ECOMMERCE channel (SKU `E2E-WS-STORE-01`), found by its SKU, made when
 *     absent, put right when a run left it off, and switched off again by the
 *     run's global teardown. Product & Services only deletes drafts, so a fresh
 *     item per run would pile up; one fixed item does not.
 *   - `createSellingSite`: a site on the test organization that sells (IQD, the
 *     headquarters branch, a delivery fee), published on its sites-domain host.
 *   - `TEST_BUYER`: the fixed test buyer's phone. Contact Center finds or creates
 *     the person by phone, so every run reuses one person. The Sales orders a run
 *     makes are cancelled by the run itself, through the Orders API's status route.
 *
 * Needs E2E_BOS_EMAIL and E2E_BOS_PASSWORD (playwright.server.config.ts).
 */

import { expect, request, type APIRequestContext } from '@playwright/test';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createSite, openSite, publish, setHeading, draftPages, type SiteRecord } from '../helpers';

export const AUTH_URL = process.env.E2E_AUTH_URL || 'https://auth.torchcorp.com';
export const SITES_DOMAIN = process.env.E2E_SITES_DOMAIN || 'sites.torchcorp.com';
export const PRODUCT_SERVICES_URL = process.env.E2E_PRODUCT_SERVICES_URL || 'https://products-services.torchcorp.com';
export const SALES_URL = process.env.E2E_SALES_URL || 'https://sales.torchcorp.com';

/** The buyer of every checkout the server specs make. An Iraqi mobile as a buyer types it; Contact Center holds it as 9647700000099. */
export const TEST_BUYER = { name: 'E2E Buyer', phone: '0770 000 0099', canonical: '9647700000099' };

export const STORE_ITEM = {
  sku: 'E2E-WS-STORE-01',
  name: 'E2E Web Studio test item',
  name_ar: 'منتج اختبار ويب ستوديو',
  price: 25000,
  currency: 'IQD',
  /** Product & Services' "Each" unit and a leaf category of the test organization (the "All - General" branch of the tree). */
  unitId: '4a2155f0-345d-42b7-88ff-5d04a79835de',
  categoryId: '60b5c788-f9f7-4c5c-8609-4fa95ccab0be',
};

/** The fixture item's one image: an 8 x 8 PNG, attached once as the item's `product_image` and kept. */
export const STORE_IMAGE = {
  name: 'e2e-store-item.png',
  mimeType: 'image/png',
  bytes: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEUlEQVR4nGM4YSOCFTEMLQkAh11GAVWqxZsAAAAASUVORK5CYII=', 'base64'),
};
export const DOCUMENTS_URL = process.env.E2E_DOCUMENTS_URL || 'https://documents.torchcorp.com';

/** Where the run remembers its fixture item, for the global teardown (a separate process from the workers). */
const FIXTURE_FILE = path.join(tmpdir(), 'web-studio-server-e2e-item.json');

/**
 * A real access token for the test account. The global setup logs in once per run and hands the token to the
 * workers in E2E_ACCESS_TOKEN (auth-service rate-limits logins: 429 after a few in a minute); a spec run on its
 * own, or a token that is not there, logs in itself, waiting out a 429.
 */
export async function accessToken(): Promise<string> {
  if (process.env.E2E_ACCESS_TOKEN) return process.env.E2E_ACCESS_TOKEN;
  const auth = await request.newContext({ baseURL: AUTH_URL });
  try {
    for (let attempt = 0; ; attempt++) {
      const response = await auth.post('/auth/login', { data: { email: process.env.E2E_BOS_EMAIL, password: process.env.E2E_BOS_PASSWORD } });
      if (response.status() === 429 && attempt < 6) {
        const wait = Number(response.headers()['retry-after']);
        await new Promise((resolve) => setTimeout(resolve, (Number.isFinite(wait) && wait > 0 ? Math.min(wait, 60) : 15) * 1000));
        continue;
      }
      expect(response.status(), 'auth-service login').toBe(200);
      return (await response.json()).accessToken as string;
    }
  } finally {
    await auth.dispose();
  }
}

async function psContext(token: string): Promise<APIRequestContext> {
  return request.newContext({ baseURL: PRODUCT_SERVICES_URL, extraHTTPHeaders: { authorization: `Bearer ${token}` } });
}

interface ItemRow {
  id: string;
  sku: string;
  status: string;
  base_price: number | string | null;
  currency: string;
}

async function findItem(ps: APIRequestContext): Promise<ItemRow | undefined> {
  const response = await ps.get(`/items?search=${encodeURIComponent(STORE_ITEM.sku)}`);
  expect(response.status(), await response.text()).toBe(200);
  const data = (await response.json()).data;
  const rows = (Array.isArray(data) ? data : data.items) as ItemRow[];
  return rows.find((row) => row.sku === STORE_ITEM.sku);
}

async function post(ps: APIRequestContext, route: string): Promise<void> {
  const response = await ps.post(route, { data: {} });
  expect(response.ok(), `${route}: ${response.status()} ${await response.text()}`).toBe(true);
}

/** The item's primary image, attached through Document Center when it has none. */
async function ensureImage(token: string, ps: APIRequestContext, itemId: string): Promise<string> {
  const listed = await ps.get(`/items/${itemId}/documents`);
  expect(listed.status(), await listed.text()).toBe(200);
  const existing = ((await listed.json()).data.product_image ?? []) as Array<{ document_id: string }>;
  if (existing.length > 0) return existing[0].document_id;

  const documents = await request.newContext({ baseURL: DOCUMENTS_URL, extraHTTPHeaders: { authorization: `Bearer ${token}` } });
  try {
    const uploaded = await documents.post('/documents/upload', { multipart: { file: { name: STORE_IMAGE.name, mimeType: STORE_IMAGE.mimeType, buffer: STORE_IMAGE.bytes } } });
    expect(uploaded.status(), await uploaded.text()).toBeLessThan(300);
    const documentId = (await uploaded.json()).data.id as string;
    const linked = await ps.post(`/items/${itemId}/documents`, { data: { document_id: documentId, link_type: 'product_image' } });
    expect(linked.ok(), await linked.text()).toBe(true);
    return documentId;
  } finally {
    await documents.dispose();
  }
}

/** The test item, active and on the ECOMMERCE channel, at its fixed price, with its one image. Safe to call from every spec. */
export async function ensureStoreItem(token: string): Promise<{ id: string; imageDocumentId: string }> {
  const ps = await psContext(token);
  try {
    let item = await findItem(ps);
    if (!item) {
      const created = await ps.post('/items', {
        data: {
          type: 'PRODUCT_STOCKABLE',
          name: STORE_ITEM.name,
          name_ar: STORE_ITEM.name_ar,
          sku: STORE_ITEM.sku,
          description: 'Made by the Web Studio server e2e (code/web-studio, pnpm e2e:server). Safe to ignore; the run switches it off when it ends.',
          base_uom_id: STORE_ITEM.unitId,
          base_price: STORE_ITEM.price,
          currency: STORE_ITEM.currency,
          category_id: STORE_ITEM.categoryId,
        },
      });
      expect(created.status(), await created.text()).toBeLessThan(300);
      const body = await created.json();
      item = (body.data ?? body) as ItemRow;
    }
    if (item.status === 'DRAFT') await post(ps, `/items/${item.id}/submit`);
    else if (item.status === 'INACTIVE') await post(ps, `/items/${item.id}/reactivate`);
    else expect(item.status, `the fixture item ${STORE_ITEM.sku} is in a state the run cannot put right`).toBe('ACTIVE');

    const current = await findItem(ps);
    expect(current?.status).toBe('ACTIVE');
    expect(Number(current?.base_price), 'the fixture item keeps its price').toBe(STORE_ITEM.price);
    expect(current?.currency).toBe(STORE_ITEM.currency);

    const channel = await ps.put(`/items/${item.id}/channels/ECOMMERCE`, { data: { active: true } });
    expect(channel.ok(), await channel.text()).toBe(true);

    const imageDocumentId = await ensureImage(token, ps, item.id);
    writeFileSync(FIXTURE_FILE, JSON.stringify({ id: item.id }));
    return { id: item.id, imageDocumentId };
  } finally {
    await ps.dispose();
  }
}

/** The run's end (global teardown): the test item off the ECOMMERCE channel and inactive, as it was made. */
export async function retireStoreItem(token: string): Promise<void> {
  if (!existsSync(FIXTURE_FILE)) return;
  const { id } = JSON.parse(readFileSync(FIXTURE_FILE, 'utf8')) as { id: string };
  const ps = await psContext(token);
  try {
    await ps.put(`/items/${id}/channels/ECOMMERCE`, { data: { active: false } });
    await ps.post(`/items/${id}/deactivate`, { data: {} });
  } finally {
    await ps.dispose();
  }
}

export const CANCEL_REASON = 'Web Studio server e2e: cancelled by the run';

/**
 * Cancels every open (draft or confirmed) Sales order of a site through the Orders API's status route: the specs'
 * afterAll, so that no order of a run stays open in Sales whatever failed. A failure here is a failure of the run.
 */
export async function cancelOpenOrders(api: APIRequestContext | undefined, siteId: string | undefined): Promise<void> {
  if (!api || !siteId) return;
  for (const status of ['draft', 'confirmed']) {
    const open = await api.get(`/ycode/api/platform/orders?site_id=${siteId}&status=${status}`);
    expect(open.ok(), `listing the ${status} orders of the site: ${open.status()}`).toBe(true);
    for (const order of (await open.json()).data as Array<{ id: string }>) {
      const cancelled = await api.post(`/ycode/api/platform/orders/${order.id}/cancel`, { data: { reason: CANCEL_REASON } });
      expect(cancelled.ok(), `cancelling order ${order.id}: ${cancelled.status()} ${await cancelled.text()}`).toBe(true);
    }
  }
}

export interface SellingSite {
  site: SiteRecord;
  host: string;
}

export interface SellingOptions {
  slugPrefix: string;
  name: string;
  /** Skip the publish (the store routes answer by host alone). */
  publishIt?: boolean;
  /** Left off: a site that does not sell. */
  selling?: boolean;
  deliveryFee?: number;
  categoryIds?: string[];
}

/** A site on the test organization with its store set: IQD, the headquarters branch, a fee, selling on; published unless asked not to. */
export async function createSellingSite(api: APIRequestContext, run: string, options: SellingOptions): Promise<SellingSite> {
  const slug = `${options.slugPrefix}-${run}`;
  const site = await createSite(api, { name: `${options.name} ${run}`, slug, languages: ['en', 'ar'], default_language: 'en' });
  const host = `${slug}.${SITES_DOMAIN}`;
  expect(site.hosts).toEqual([host]);

  const settings = await api.get(`/ycode/api/platform/sites/${site.id}/store`);
  expect(settings.status(), await settings.text()).toBe(200);
  const branches = ((await settings.json()).data.branches ?? []) as Array<{ id: string; name: string }>;
  const branch = branches.find((b) => /headquarters/i.test(b.name)) ?? branches[0];
  expect(branch, 'the test organization has an active branch').toBeTruthy();

  const saved = await api.patch(`/ycode/api/platform/sites/${site.id}/store`, {
    data: {
      selling: options.selling ?? true,
      currency: 'IQD',
      branch_id: branch.id,
      delivery_fee: options.deliveryFee ?? 2500,
      category_ids: options.categoryIds ?? [],
    },
  });
  expect(saved.status(), await saved.text()).toBe(200);

  if (options.publishIt !== false) {
    expect((await openSite(api, site.id)).status()).toBe(303);
    const home = (await draftPages(api)).find((page) => page.is_index);
    await setHeading(api, home!.id, `${options.name} ${run}`);
    await publish(api);
  }
  return { site, host };
}

/** A visitor of a published site, over the public internet: its own host, its own Origin, no cookies. */
export async function visitor(host: string, extraHeaders: Record<string, string> = {}): Promise<APIRequestContext> {
  return request.newContext({ baseURL: `https://${host}`, extraHTTPHeaders: { origin: `https://${host}`, ...extraHeaders } });
}

export async function deleteSite(api: APIRequestContext | undefined, site: SiteRecord | undefined): Promise<void> {
  if (api && site) await api.delete(`/ycode/api/platform/sites/${site.id}`);
}
