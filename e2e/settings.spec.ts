/**
 * Session 7 "done when": the site settings API.
 *
 * GET and PATCH /ycode/api/platform/sites/{id}/settings: the name kept equal in
 * All sites and the builder's site_name; languages added and removed (the
 * removal asks for a second call with confirm and takes the translations with
 * it); a custom host accepted only if it is one of the organization's verified
 * domains and answering after the next publish; SEO defaults in the published
 * head only where the page has no value of its own; the slug moving the default
 * address, before and after the first publish.
 */

import { expect, request, test, type APIRequestContext } from '@playwright/test';
import knex from 'knex';
import { createSite, draftPages, listSites, openSite, publish, publishedSite, setHeading, signIn, TEST_SITES_DOMAIN, type SiteRecord } from './helpers';

test.describe.configure({ mode: 'serial' });

const RUN = Date.now().toString(36);
const ORG = '0d0d0d0d-0d0d-4d0d-8d0d-0d0d0d0d0d0d';
const OTHER_ORG = '0e0e0e0e-0e0e-4e0e-8e0e-0e0e0e0e0e0e';
const USER = { sub: '1d1d1d1d-1d1d-4d1d-8d1d-1d1d1d1d1d1d', email: 'owner-d@example.com', name: 'Owner D', org: ORG };
const STRANGER = { sub: '1e1e1e1e-1e1e-4e1e-8e1e-1e1e1e1e1e1e', email: 'owner-e@example.com', name: 'Owner E', org: OTHER_ORG };
const SLUG = `alnoor-${RUN}`;
const HOST = `${SLUG}.${TEST_SITES_DOMAIN}`;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

let baseURL: string;
let api: APIRequestContext;
let stranger: APIRequestContext;
let site: SiteRecord;
let other: SiteRecord;

const url = (id = site.id) => `/ycode/api/platform/sites/${id}/settings`;
const read = async () => (await (await api.get(url())).json()).data;
const patch = (data: unknown, id = site.id) => api.patch(url(id), { data });

async function visit(host: string, path = '/') {
  const anonymous = await publishedSite(baseURL, host);
  try {
    const response = await anonymous.get(path);
    return { status: response.status(), html: await response.text() };
  } finally {
    await anonymous.dispose();
  }
}

test.beforeAll(async ({ baseURL: configured }) => {
  baseURL = configured!;
  api = await signIn(baseURL, USER);
  stranger = await signIn(baseURL, STRANGER);
  site = await createSite(api, { name: 'Al Noor', slug: SLUG, languages: ['ar', 'en'], default_language: 'ar' });
  other = await createSite(api, { name: 'Other', slug: `other-${RUN}`, languages: ['en'], default_language: 'en' });
  expect((await openSite(api, site.id)).status()).toBe(303);
});

test.afterAll(async () => {
  await api?.dispose();
  await stranger?.dispose();
});

test('GET returns the site\'s settings as the screen shows them', async () => {
  const settings = await read();
  expect(settings).toMatchObject({ id: site.id, name: 'Al Noor', slug: SLUG, status: 'draft', last_published_at: null, default_language: 'ar' });
  expect(settings.languages.map((l: { code: string }) => l.code).sort()).toEqual(['ar', 'en']);
  expect(settings.domain).toMatchObject({ default_host: HOST, custom_host: null, hosts: [HOST], check: 'on', verified_domains: ['verified.test', 'shop.verified.test'], verified_domains_error: null });
  expect(settings.seo).toEqual({ title: null, description: null, image: null });
});

test('no session is 401, another organization\'s site is 404, a reader cannot PATCH', async () => {
  const anonymous = await request.newContext({ baseURL });
  expect((await anonymous.get(url())).status()).toBe(401);
  expect((await anonymous.patch(url(), { data: { name: 'x' } })).status()).toBe(401);
  await anonymous.dispose();

  expect((await stranger.get(url())).status()).toBe(404);
  expect((await stranger.patch(url(), { data: { name: 'Mine now' } })).status()).toBe(404);

  const reader = await request.newContext({ baseURL });
  const login = await reader.post('/ycode/api/auth/dev-login', { data: { ...USER, perms: { 'webstudio.manage_sites': ['r'], 'webstudio.manage_content': ['r'] } } });
  expect(login.status()).toBe(200);
  expect((await reader.get(url())).status()).toBe(200);
  expect((await reader.patch(url(), { data: { name: 'Reader was here' } })).status()).toBe(403);
  await reader.dispose();
  expect((await read()).name).toBe('Al Noor');
});

test('a bad body is refused with the fields named, and nothing changes', async () => {
  const response = await patch({ name: '', slug: 'Bad Slug', custom_host: 'https://x.com', colour: 'red' });
  expect(response.status()).toBe(400);
  expect((await response.json()).details.length).toBeGreaterThanOrEqual(3);
  expect((await patch('not json')).status()).toBe(400);
  expect((await read()).name).toBe('Al Noor');
});

test('the name is kept equal in All sites and in the builder\'s site_name, from either side', async () => {
  const response = await patch({ name: '  Al Noor Trading  ' });
  expect(response.status(), await response.text()).toBe(200);
  expect((await response.json()).data.name).toBe('Al Noor Trading');
  expect((await listSites(api)).find((s) => s.id === site.id)?.name).toBe('Al Noor Trading');
  expect((await (await api.get('/ycode/api/settings/site_name')).json()).data).toBe('Al Noor Trading');

  // The builder's General settings page writes site_name; All sites follows.
  const fromBuilder = await api.put('/ycode/api/settings/site_name', { data: { value: 'Renamed in the builder' } });
  expect(fromBuilder.status(), await fromBuilder.text()).toBe(200);
  expect((await listSites(api)).find((s) => s.id === site.id)?.name).toBe('Renamed in the builder');
  expect((await read()).name).toBe('Renamed in the builder');
  expect((await listSites(api)).find((s) => s.id === other.id)?.name).toBe('Other');
});

test('removing a language asks first, then removes it with its translations; adding creates it', async () => {
  const locales = async () => (await (await api.get('/ycode/api/locales')).json()).data as Array<{ id: string; code: string; is_default: boolean }>;
  const before = await locales();
  const en = before.find((l) => l.code === 'en')!;
  const { home } = { home: (await draftPages(api)).find((p) => p.is_index)!.id };
  // Straight into the table: POST /translations cannot save in this port yet (see the pull request's Notes).
  const db = knex({ client: 'pg', connection: process.env.DATABASE_URL_TEST });
  try {
    await db.transaction(async (trx) => {
      await trx.raw('SELECT set_tenant_context(?::uuid)', [site.id]);
      await trx('translations').insert({ locale_id: en.id, source_type: 'page', source_id: home, content_key: 'name', content_type: 'text', content_value: 'Home', is_completed: true });
    });
  } finally {
    await db.destroy();
  }

  const asked = await patch({ languages: ['ar'] });
  expect(asked.status()).toBe(409);
  expect(await asked.json()).toMatchObject({ error: 'confirmation_required', remove: [{ code: 'en', translations: 1 }] });
  expect((await locales()).map((l) => l.code).sort()).toEqual(['ar', 'en']);

  // Published with both languages first, so the 404 below is the removal's doing.
  await publish(api);
  expect((await visit(HOST, '/en')).status).toBe(200);

  const done = await patch({ languages: ['ar'], confirm: true });
  expect(done.status(), await done.text()).toBe(200);
  expect((await done.json()).data.languages.map((l: { code: string }) => l.code)).toEqual(['ar']);
  expect((await locales()).map((l) => l.code)).toEqual(['ar']);
  expect(((await (await api.get(`/ycode/api/translations?locale_id=${en.id}`)).json()).data as unknown[])).toEqual([]);

  // The published site keeps the language until the next publish takes it off.
  expect((await visit(HOST, '/en')).status).toBe(200);
  await publish(api);
  expect((await visit(HOST, '/en')).status).toBe(404);
  expect((await visit(HOST, '/')).status).toBe(200);

  const added = await patch({ languages: ['ar', 'en'] });
  expect(added.status(), await added.text()).toBe(200);
  const after = await locales();
  expect(after.map((l) => l.code).sort()).toEqual(['ar', 'en']);
  expect(after.find((l) => l.code === 'ar')!.is_default).toBe(true);
  const reAdded = after.find((l) => l.code === 'en')!;
  expect((await (await api.get(`/ycode/api/translations?locale_id=${reAdded.id}`)).json()).data).toEqual([]);

  // Added through PATCH, the language answers at its path after the next publish.
  expect((await visit(HOST, '/en')).status).toBe(404);
  await publish(api);
  const english = await visit(HOST, '/en');
  expect(english.status).toBe(200);
  expect(english.html).toMatch(/<html[^>]*\blang="en"/);
});

test('the default language moves; the default cannot be removed without naming another', async () => {
  const noDefault = await patch({ languages: ['en'], confirm: true });
  expect(noDefault.status()).toBe(400);
  expect((await read()).languages).toHaveLength(2);

  const moved = await patch({ default_language: 'en' });
  expect(moved.status(), await moved.text()).toBe(200);
  expect((await moved.json()).data.default_language).toBe('en');
  expect((await listSites(api)).find((s) => s.id === site.id)?.default_locale).toBe('en');

  const back = await patch({ languages: ['ar', 'en'], default_language: 'ar' });
  expect((await back.json()).data.default_language).toBe('ar');
  expect((await patch({ languages: ['ar'], default_language: 'en' })).status()).toBe(400);
});

test('a custom host must be one of the verified domains, and answers after the next publish', async () => {
  const unverified = await patch({ custom_host: 'www.not-verified.test' });
  expect(unverified.status()).toBe(422);
  expect(await unverified.json()).toMatchObject({ code: 'domain_not_verified', verified_domains: ['verified.test', 'shop.verified.test'] });
  const subdomain = await patch({ custom_host: 'blog.verified.test' });
  expect(subdomain.status()).toBe(422);
  const underSitesDomain = await patch({ custom_host: `squat-${RUN}.${TEST_SITES_DOMAIN}` });
  expect(underSitesDomain.status()).toBe(400);
  expect((await read()).domain.custom_host).toBeNull();

  const set = await patch({ custom_host: 'verified.test' });
  expect(set.status(), await set.text()).toBe(200);
  expect((await set.json()).data.domain).toMatchObject({ default_host: HOST, custom_host: 'verified.test', hosts: [HOST, 'verified.test'] });

  // The host is the site's at once, but what it shows is what was published: nothing of the draft until the next publish.
  await setHeading(api, (await draftPages(api)).find((p) => p.is_index)!.id, 'Hello on the custom host');
  expect((await visit('verified.test')).html).not.toContain('Hello on the custom host');
  await publish(api);
  const published = await visit('verified.test');
  expect(published.status).toBe(200);
  expect(published.html).toContain('Hello on the custom host');
  expect((await read()).status).toBe('published');

  const taken = await patch({ custom_host: 'verified.test' }, other.id);
  expect(taken.status()).toBe(409);

  const removed = await patch({ custom_host: null });
  expect(removed.status()).toBe(200);
  expect((await removed.json()).data.domain).toMatchObject({ custom_host: null, hosts: [HOST] });
  expect((await visit('verified.test')).status).toBe(404);
  expect((await visit(HOST)).status).toBe(200);
});

test('SEO defaults reach the published head where a page has no value of its own', async () => {
  const upload = await api.post('/ycode/api/assets/upload', {
    multipart: { source: 'file-manager', file: { name: 'share.png', mimeType: 'image/png', buffer: PNG } },
  });
  expect(upload.status(), await upload.text()).toBe(200);
  const asset = (await upload.json()).data as { id: string; storage_path: string | null };
  expect(asset.storage_path, 'the upload is stored, so the page can link to it').toBeTruthy();
  const assetId = asset.id;

  const missing = await patch({ seo: { image: '3f0b2c7e-2d7a-4c3e-9a1e-7b1d2e3f4a5b' } });
  expect(missing.status()).toBe(400);

  const saved = await patch({ seo: { title: 'Al Noor | Baghdad', description: 'Lighting for every room', image: assetId } });
  expect(saved.status(), await saved.text()).toBe(200);
  expect((await saved.json()).data.seo).toMatchObject({ title: 'Al Noor | Baghdad', description: 'Lighting for every room', image: { id: assetId } });

  await publish(api);
  const home = await visit(HOST);
  expect(home.html).toContain('<title>Al Noor | Baghdad</title>');
  expect(home.html).toContain('content="Lighting for every room"');
  expect(home.html).toMatch(/property="og:image" content="[^"]+share[^"]*"|property="og:image" content="[^"]*\/platform-storage\/[^"]*"/);

  // A page with its own title keeps it.
  const pages = await draftPages(api);
  const index = pages.find((p) => p.is_index)!;
  const own = await api.put(`/ycode/api/pages/${index.id}`, { data: { settings: { seo: { title: 'Own title' } } } });
  expect(own.status(), await own.text()).toBe(200);
  await publish(api);
  const ownHome = await visit(HOST);
  expect(ownHome.html).toContain('<title>Own title</title>');
  expect(ownHome.html).toContain('content="Lighting for every room"'); // the description still falls back

  // Clearing a default removes it.
  const cleared = await patch({ seo: { title: null, description: '', image: null } });
  expect((await cleared.json()).data.seo).toEqual({ title: null, description: null, image: null });
});

test('the slug can change before the first publish and after it; the default address follows', async () => {
  const fresh = await createSite(api, { name: 'Fresh', slug: `fresh-${RUN}`, languages: ['en'], default_language: 'en' });
  const draft = await patch({ slug: `renamed-${RUN}` }, fresh.id);
  expect(draft.status(), await draft.text()).toBe(200);
  expect((await draft.json()).data).toMatchObject({ slug: `renamed-${RUN}`, status: 'draft', domain: { default_host: `renamed-${RUN}.${TEST_SITES_DOMAIN}`, hosts: [`renamed-${RUN}.${TEST_SITES_DOMAIN}`] } });

  const taken = await patch({ slug: `other-${RUN}` });
  expect(taken.status()).toBe(409);
  expect((await taken.json()).error).toContain(`other-${RUN}.${TEST_SITES_DOMAIN}`); // the default address is what clashes
  expect((await read()).slug).toBe(SLUG);

  // The first site is published: the slug still changes, the old address stops, the new one answers.
  const newSlug = `alnoor2-${RUN}`;
  const moved = await patch({ slug: newSlug });
  expect(moved.status(), await moved.text()).toBe(200);
  expect((await moved.json()).data).toMatchObject({ slug: newSlug, status: 'published', domain: { default_host: `${newSlug}.${TEST_SITES_DOMAIN}` } });
  expect((await visit(HOST)).status).toBe(404);
  expect((await visit(`${newSlug}.${TEST_SITES_DOMAIN}`)).status).toBe(200);
  expect((await listSites(api)).find((s) => s.id === site.id)?.hosts).toEqual([`${newSlug}.${TEST_SITES_DOMAIN}`]);
});
