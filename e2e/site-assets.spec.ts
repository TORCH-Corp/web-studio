/**
 * Session 10: the share image of Site settings is picked from the site's images.
 *
 * GET /ycode/api/platform/sites/{id}/assets: the images of one site that can be
 * its share image (JPEG, PNG, GIF, WebP; drafts), newest first, with a search
 * and pages; another site's images never; another organization's site not
 * found; manage_sites r, the leaf of the settings it serves. Each image is
 * served by GET …/assets/{assetId}, as `/a/` serves it, for that site only; the
 * id is one the settings API accepts.
 */

import { expect, request, test, type APIRequestContext } from '@playwright/test';
import { createSite, openSite, signIn, type SiteRecord } from './helpers';

test.describe.configure({ mode: 'serial' });

const RUN = Date.now().toString(36);
const ORG = '0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f';
const OTHER_ORG = '10101010-1010-4010-8010-101010101010';
const USER = { sub: '1f1f1f1f-1f1f-4f1f-8f1f-1f1f1f1f1f1f', email: 'owner-f@example.com', name: 'Owner F', org: ORG };
const STRANGER = { sub: '20202020-2020-4020-8020-202020202020', email: 'owner-g@example.com', name: 'Owner G', org: OTHER_ORG };
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>';

interface Listed {
  data: Array<{ id: string; filename: string; mime_type: string; width: number | null; height: number | null }>;
  total: number;
  page: number;
  limit: number;
  has_more: boolean;
}

let baseURL: string;
let api: APIRequestContext;
let site: SiteRecord;
let other: SiteRecord;
let svgId: string;

const url = (id = site.id, query = '') => `/ycode/api/platform/sites/${id}/assets${query}`;
const imageUrl = (assetId: string, query = '', id = site.id) => `/ycode/api/platform/sites/${id}/assets/${assetId}${query}`;

async function list(query = '', id = site.id): Promise<Listed> {
  const response = await api.get(url(id, query));
  expect(response.status(), await response.text()).toBe(200);
  return (await response.json()) as Listed;
}

/** Uploads a PNG to the open site; ycode stores it as WebP, named without the extension. */
async function uploadPng(name: string): Promise<string> {
  const response = await api.post('/ycode/api/assets/upload', {
    multipart: { source: 'file-manager', file: { name, mimeType: 'image/png', buffer: PNG } },
  });
  expect(response.status(), await response.text()).toBe(200);
  return (await response.json()).data.id as string;
}

test.beforeAll(async ({ baseURL: configured }) => {
  baseURL = configured!;
  api = await signIn(baseURL, USER);
  site = await createSite(api, { name: 'Gallery', slug: `gallery-${RUN}`, languages: ['en'], default_language: 'en' });
  other = await createSite(api, { name: 'Elsewhere', slug: `elsewhere-${RUN}`, languages: ['en'], default_language: 'en' });

  // The other site's image first, then this site's: uploads go to the open site.
  expect((await openSite(api, other.id)).status()).toBe(303);
  await uploadPng('elsewhere-banner.png');

  expect((await openSite(api, site.id)).status()).toBe(303);
  await uploadPng('storefront.png');
  await uploadPng('Team Photo.png');
  await uploadPng('100%_sale.png');
  const svg = await api.post('/ycode/api/assets', { data: { filename: 'icon.svg', content: SVG } });
  expect(svg.status(), await svg.text()).toBe(200);
  svgId = (await svg.json()).data.id;
});

test.afterAll(async () => {
  await api?.dispose();
});

test('lists this site\'s share-image types, newest first, never another site\'s or an SVG', async () => {
  const listed = await list();
  expect(listed.data.map((image) => image.filename)).toEqual(['100%_sale', 'Team Photo', 'storefront']);
  expect(listed).toMatchObject({ total: 3, page: 1, limit: 50, has_more: false });
  // The builder stores an uploaded bitmap as WebP (lib/file-upload.ts), one of the share-image types.
  expect(listed.data.every((image) => image.mime_type === 'image/webp')).toBe(true);

  expect((await list('', other.id)).data.map((image) => image.filename)).toEqual(['elsewhere-banner']);
});

test('each image is served by id, resized on request, for its own site only', async () => {
  const [image] = (await list('?search=storefront')).data;
  const full = await api.get(imageUrl(image.id));
  expect(full.status(), await full.text()).toBe(200);
  expect(full.headers()['content-type']).toContain('image/webp');
  expect((await full.body()).length).toBeGreaterThan(0);

  const small = await api.get(imageUrl(image.id, '?width=16'));
  expect(small.status()).toBe(200);
  expect(small.headers()['content-type']).toContain('image/webp');

  // An inline SVG (no file) is served as `/a/` serves it, scripts off.
  const svg = await api.get(imageUrl(svgId));
  expect(svg.status()).toBe(200);
  expect(svg.headers()['content-type']).toContain('image/svg+xml');
  expect(svg.headers()['content-security-policy']).toBe("script-src 'none'");

  const [elsewhere] = (await list('', other.id)).data;
  expect((await api.get(imageUrl(elsewhere.id))).status(), 'another site\'s image under this site').toBe(404);
  expect((await api.get(imageUrl(elsewhere.id, '', other.id))).status()).toBe(200);
  expect((await api.get(imageUrl('not-an-id'))).status()).toBe(404);

  const anonymous = await request.newContext({ baseURL });
  expect((await anonymous.get(imageUrl(image.id))).status()).toBe(401);
  await anonymous.dispose();
  const stranger = await signIn(baseURL, STRANGER);
  expect((await stranger.get(imageUrl(image.id))).status()).toBe(404);
  await stranger.dispose();
});

test('search matches part of the name, ignoring case, wildcards literally; pages say whether more follow', async () => {
  expect((await list('?search=team')).data.map((image) => image.filename)).toEqual(['Team Photo']);
  expect((await list('?search=%25_')).data.map((image) => image.filename)).toEqual(['100%_sale']);
  expect((await list('?search=nothing-like-this')).total).toBe(0);

  const first = await list('?limit=2');
  expect(first).toMatchObject({ total: 3, page: 1, limit: 2, has_more: true });
  expect(first.data).toHaveLength(2);
  const second = await list('?limit=2&page=2');
  expect(second).toMatchObject({ total: 3, page: 2, has_more: false });
  expect(second.data.map((image) => image.filename)).toEqual(['storefront']);
});

test('a bad query is 400 with the field named', async () => {
  const response = await api.get(url(site.id, '?limit=500'));
  expect(response.status()).toBe(400);
  expect((await response.json()).details[0]).toMatch(/^limit:/);
});

test('no session is 401, another organization\'s site is 404, manage_sites r reads, without it 403', async () => {
  const anonymous = await request.newContext({ baseURL });
  expect((await anonymous.get(url())).status()).toBe(401);
  await anonymous.dispose();

  const stranger = await signIn(baseURL, STRANGER);
  expect((await stranger.get(url())).status()).toBe(404);
  await stranger.dispose();

  const reader = await signIn(baseURL, { ...USER, perms: { 'webstudio.manage_sites': ['r'] } });
  expect((await reader.get(url())).status()).toBe(200);
  await reader.dispose();

  const contentOnly = await signIn(baseURL, { ...USER, perms: { 'webstudio.manage_content': ['r', 'u'] } });
  expect((await contentOnly.get(url())).status()).toBe(403);
  await contentOnly.dispose();
});

test('a listed image is one the settings API takes as the share image', async () => {
  const [image] = (await list('?search=storefront')).data;
  const saved = await api.patch(`/ycode/api/platform/sites/${site.id}/settings`, { data: { seo: { image: image.id } } });
  expect(saved.status(), await saved.text()).toBe(200);
  expect((await saved.json()).data.seo.image).toMatchObject({ id: image.id });
});
