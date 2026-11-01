/**
 * Session 8 "done when": files uploaded in the builder are stored in Document
 * Center under the organization and served from Web Studio's own route.
 *
 * The suite runs with PLATFORM_STORAGE=document-center against the recorded
 * contract in e2e/fake-document-center.ts. An image uploaded in the builder
 * appears in Document Center under the organization, in the Web Studio
 * folder; its public_url (the address the builder and the published page use)
 * answers with the bytes; deleting the asset removes the document; another
 * organization does not see it, in Web Studio or in Document Center.
 */

import { expect, request, test, type APIRequestContext } from '@playwright/test';
import { createSite, openSite, signIn } from './helpers';

test.describe.configure({ mode: 'serial' });

const RUN = Date.now().toString(36);
const DC = `http://127.0.0.1:${Number(process.env.E2E_DC_PORT || 3103)}`;
const ORG_A = '0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a';
const ORG_B = '0b0b0b0b-0b0b-4b0b-8b0b-0b0b0b0b0b0b';
const USER_A = { sub: '1a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a', email: 'owner-a@example.com', name: 'Owner A', org: ORG_A };
const USER_B = { sub: '1b1b1b1b-1b1b-4b1b-8b1b-1b1b1b1b1b1b', email: 'owner-b@example.com', name: 'Owner B', org: ORG_B };
// A 1x1 PNG.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');

let baseURL: string;
let orgA: APIRequestContext;
let orgB: APIRequestContext;
let siteA: string;
let siteB: string;
let asset: { id: string; storage_path: string; public_url: string };

async function documentsOf(org: string) {
  const state = await request.newContext();
  const res = await state.get(`${DC}/__state?entity=${org}`);
  const body = (await res.json()) as { data: Array<{ id: string; name: string; filename: string; folder: string | null; linkedEntityId?: string; deleted: boolean; size: number }> };
  await state.dispose();
  return body.data;
}

test.beforeAll(async ({ baseURL: configured }) => {
  baseURL = configured!;
  orgA = await signIn(baseURL, USER_A);
  orgB = await signIn(baseURL, USER_B);
  siteA = (await createSite(orgA, { name: `Storage A ${RUN}`, slug: `st-a-${RUN}`, languages: ['en'], default_language: 'en' })).id;
  siteB = (await createSite(orgB, { name: `Storage B ${RUN}`, slug: `st-b-${RUN}`, languages: ['en'], default_language: 'en' })).id;
  expect((await openSite(orgA, siteA)).status()).toBeLessThan(400);
  expect((await openSite(orgB, siteB)).status()).toBeLessThan(400);
});

test.afterAll(async () => {
  await orgA?.dispose();
  await orgB?.dispose();
});

test('an image uploaded in the builder lands in Document Center under the organization', async () => {
  const res = await orgA.post('/ycode/api/assets/upload', {
    multipart: { file: { name: 'pixel.png', mimeType: 'image/png', buffer: PNG }, source: 'file-manager' },
  });
  expect(res.status(), await res.text()).toBe(200);
  asset = (await res.json()).data;
  expect(asset.public_url).toContain(`/platform-storage/${siteA}/`);

  const docs = await documentsOf(ORG_A);
  const doc = docs.find((d) => d.name.endsWith(asset.storage_path));
  expect(doc, JSON.stringify(docs)).toBeTruthy();
  expect(doc!.folder).toBe('Web Studio');
  expect(doc!.linkedEntityId).toBe(siteA);
  expect(doc!.size).toBe(PNG.length);
  expect(doc!.deleted).toBe(false);
});

test('the public URL serves the bytes from Document Center, to anyone', async () => {
  const anonymous = await request.newContext();
  const res = await anonymous.get(asset.public_url);
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toBe('image/png');
  expect(res.headers()['cache-control']).toContain('public');
  expect(Buffer.compare(await res.body(), PNG)).toBe(0);
  await anonymous.dispose();
});

test('the builder\'s asset list carries the new public_url', async () => {
  const list = (await (await orgA.get('/ycode/api/assets')).json()).data as Array<{ id: string; public_url: string }>;
  expect(list.find((a) => a.id === asset.id)?.public_url).toBe(asset.public_url);
});

test('organization B does not see the file, in Web Studio or in Document Center', async () => {
  const list = (await (await orgB.get('/ycode/api/assets')).json()).data as Array<{ id: string }>;
  expect(list.find((a) => a.id === asset.id)).toBeUndefined();
  expect(await documentsOf(ORG_B)).toEqual([]);

  // The same key under B's site is not found: files belong to their site.
  const other = asset.public_url.replace(siteA, siteB);
  const anonymous = await request.newContext();
  expect((await anonymous.get(other)).status()).toBe(404);
  await anonymous.dispose();
});

test('deleting the asset in the builder removes the document in Document Center', async () => {
  const res = await orgA.delete(`/ycode/api/assets/${asset.id}`);
  expect(res.status(), await res.text()).toBe(200);

  const doc = (await documentsOf(ORG_A)).find((d) => d.name.endsWith(asset.storage_path));
  expect(doc?.deleted).toBe(true);

  const anonymous = await request.newContext();
  expect((await anonymous.get(asset.public_url)).status()).toBe(404);
  await anonymous.dispose();
});
