/**
 * A site made from a template gets the template's collections, on the deployed service (part 3, session W11).
 *
 * The test account's organization is the templates organization, so the run makes its own test template there: one
 * collection (Team: Name, Slug, Role), two items with Arabic translations, a list on the home page and an item page.
 * A site made from it is published on https://{slug}.sites.torchcorp.com, and a visitor over the public internet reads
 * both people on the list page and each on her own page, in English and in Arabic. The template is a row in the Templates
 * list of every organization for the minutes the run takes, and is deleted at the end with the site.
 *
 * The copy now reads collections and checks every pointer, so a third test makes a site from each of TORCH's real
 * templates (company site, landing page, online store), with Arabic as the default language, which the company site
 * is not: none of them carries a collection or a pointer that cannot be followed, and the copy must still go through.
 *
 * What it leaves: the sites, soft-deleted (a template and the sites made from it and from the real templates, with
 * their collections). Nothing else.
 */

import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test';
import { createSite, draftPages, openSite, publish, signInWithToken, type SiteRecord } from '../helpers';
import { accessToken, deleteSite, SITES_DOMAIN, visitor } from './real-services';

test.describe.configure({ mode: 'serial' });

const RUN = Date.now().toString(36);
const PEOPLE = [
  { name: `Sara Ali ${RUN}`, slug: `sara-${RUN}`, role: 'Designer', ar: { name: 'سارة علي', role: 'مصممة' } },
  { name: `Omar Hassan ${RUN}`, slug: `omar-${RUN}`, role: 'Engineer', ar: { name: 'عمر حسن', role: 'مهندس' } },
];

interface Field { id: string; key: string | null; name: string; type: string }
interface Item { id: string; values: Record<string, string> }
interface Layer { id: string; name: string; classes?: string; settings?: unknown; variables?: unknown; children?: Layer[] }

let baseURL: string;
let api: APIRequestContext;
let template: SiteRecord;
let site: SiteRecord;
let host: string;
const fromRealTemplates: SiteRecord[] = [];

async function data<T = Record<string, any>>(response: APIResponse, status = 200): Promise<T> {
  expect(response.status(), await response.text()).toBe(status);
  return (await response.json()).data as T;
}

const variable = (field: Field, source: 'collection' | 'page', layerId?: string) => ({
  type: 'dynamicVariable',
  attrs: { label: field.name, variable: { type: 'field', data: { source, field_id: field.id, field_type: field.type, relationships: [], ...(layerId ? { collection_layer_id: layerId } : {}) } } },
});
const line = (id: string, tag: string, ...parts: Array<ReturnType<typeof variable> | { type: 'text'; text: string }>): Layer => ({
  id, name: tag.startsWith('h') ? 'heading' : 'text', settings: { tag }, classes: '', children: [],
  variables: { text: { type: 'dynamic_rich_text', data: { content: { type: 'doc', content: [{ type: 'paragraph', content: parts }] } } } },
});

async function saveLayers(pageId: string, children: Layer[]): Promise<void> {
  const response = await api.put(`/ycode/api/layers?page_id=${pageId}`, { data: { layers: [{ id: 'body', name: 'body', classes: '', children }] } });
  expect(response.status(), await response.text()).toBe(200);
}

/** What a visitor of the site is answered for a path, over the public internet. */
async function read(path: string): Promise<{ status: number; body: string }> {
  const person = await visitor(host);
  try {
    const response = await person.get(path, { maxRedirects: 0 });
    const html = await response.text();
    // React puts a comment between two text nodes: "Name / Role" reads as one string without them.
    return { status: response.status(), body: html.slice(html.indexOf('<body')).replace(/<!-- -->/g, '') };
  } finally {
    await person.dispose();
  }
}

test.beforeAll(async ({ baseURL: configured }) => {
  baseURL = configured!;
  api = await signInWithToken(baseURL, await accessToken());
});

test.afterAll(async () => {
  for (const made of fromRealTemplates) await deleteSite(api, made);
  await deleteSite(api, site);
  await deleteSite(api, template);
  await api?.dispose();
});

test('a test template with one collection, two items with Arabic translations, a list page and an item page', async () => {
  template = await createSite(api, { name: `E2E template ${RUN} (ignore)`, slug: `e2e-tpl-${RUN}`, languages: ['en', 'ar'], default_language: 'en', is_template: true, template: { name: { en: `E2E template ${RUN} (ignore)` } } });
  expect(template.is_template).toBe(true);
  expect((await openSite(api, template.id)).status()).toBe(303);

  const collection = await data<{ id: string }>(await api.post('/ycode/api/collections', { data: { name: 'Team' } }), 201);
  const fields: Field[] = [];
  for (const [index, field] of [{ name: 'Name', key: 'name', type: 'text' }, { name: 'Slug', key: 'slug', type: 'text' }, { name: 'Role', type: 'text' }].entries()) {
    fields.push(await data<Field>(await api.post(`/ycode/api/collections/${collection.id}/fields`, { data: { ...field, order: index + 1 } }), 201));
  }
  const [name, slug, role] = fields;

  const locales = await data<Array<{ id: string; code: string }>>(await api.get('/ycode/api/locales'));
  const arabic = locales.find((locale) => locale.code === 'ar')!;
  for (const person of PEOPLE) {
    const created = await data<Item>(await api.post(`/ycode/api/collections/${collection.id}/items`, { data: { values: { [name.id]: person.name, [slug.id]: person.slug, [role.id]: person.role } } }), 201);
    // The item row is written first and its values after it.
    await expect.poll(async () => {
      const items = (await data<{ items: Item[] }>(await api.get(`/ycode/api/collections/${collection.id}/items?limit=50`))).items;
      return Object.keys(items.find((item) => item.id === created.id)?.values ?? {}).length;
    }, { timeout: 30_000 }).toBeGreaterThanOrEqual(3);
    for (const [field, value] of [[name, person.ar.name], [role, person.ar.role]] as const) {
      const translated = await api.post('/ycode/api/translations', { data: { locale_id: arabic.id, source_type: 'cms', source_id: created.id, content_key: field.key ? `field:key:${field.key}` : `field:id:${field.id}`, content_type: 'text', content_value: value, is_completed: true } });
      expect(translated.status(), await translated.text()).toBe(201);
    }
  }

  const home = (await draftPages(api)).find((page) => page.is_index)!;
  const member = await data<{ id: string }>(await api.post('/ycode/api/pages', { data: { name: 'Person', slug: '*', is_dynamic: true, is_published: false, is_publishable: true, settings: { cms: { collection_id: collection.id, slug_field_id: slug.id } } } }));
  await saveLayers(home.id, [{
    id: 'team-list', name: 'div', classes: '', variables: { collection: { id: collection.id, sort_by: name.id, sort_order: 'asc' } },
    children: [line('team-line', 'h2', variable(name, 'collection', 'team-list'), { type: 'text', text: ' / ' }, variable(role, 'collection', 'team-list'))],
  }]);
  await saveLayers(member.id, [line('member-name', 'h1', variable(name, 'page')), line('member-role', 'p', variable(role, 'page'))]);
});

test('a site made from the template has them, and shows them published, in English and in Arabic', async () => {
  site = await createSite(api, { name: `E2E from template ${RUN}`, slug: `e2e-tplc-${RUN}`, languages: ['en', 'ar'], default_language: 'en', template_id: template.id });
  host = `${site.slug}.${SITES_DOMAIN}`;
  expect(site.hosts).toEqual([host]);
  expect((await openSite(api, site.id)).status()).toBe(303);

  const collections = await data<Array<{ id: string; name: string }>>(await api.get('/ycode/api/collections'));
  expect(collections.map((collection) => collection.name)).toEqual(['Team']);
  await publish(api);

  const english = await read('/');
  expect(english.status).toBe(200);
  for (const person of PEOPLE) expect(english.body).toContain(`${person.name} / ${person.role}`);
  const arabic = await read('/ar');
  expect(arabic.status).toBe(200);
  for (const person of PEOPLE) {
    expect(arabic.body).toContain(`${person.ar.name} / ${person.ar.role}`);
    expect(arabic.body).not.toContain(person.name);
  }
  for (const person of PEOPLE) {
    const page = await read(`/${person.slug}`);
    expect(page.status, person.slug).toBe(200);
    expect(page.body).toContain(person.name);
    expect(page.body).toContain(person.role);
    const inArabic = await read(`/ar/${person.slug}`);
    expect(inArabic.status, `ar ${person.slug}`).toBe(200);
    expect(inArabic.body).toContain(person.ar.name);
    expect(inArabic.body).toContain(person.ar.role);
  }
  expect((await read('/nobody')).status).toBe(404);
});

test('a site is made from each of TORCH\'s real templates, with Arabic as its default language', async () => {
  const templates = await data<Array<{ id: string; slug: string; page_count: number }>>(await api.get('/ycode/api/platform/templates'));
  const real = templates.filter((candidate) => ['company-site', 'landing-page', 'online-store'].includes(candidate.slug));
  expect(real.map((candidate) => candidate.slug).sort()).toEqual(['company-site', 'landing-page', 'online-store']);

  for (const candidate of real) {
    const made = await createSite(api, { name: `E2E from ${candidate.slug} ${RUN}`, slug: `e2e-${candidate.slug}-${RUN}`, languages: ['ar', 'en'], default_language: 'ar', template_id: candidate.id });
    fromRealTemplates.push(made);
    expect((await openSite(api, made.id)).status(), candidate.slug).toBe(303);
    const pages = (await data<Array<{ error_page: number | null }>>(await api.get('/ycode/api/pages'))).filter((page) => page.error_page === null);
    expect(pages.length, `the pages of ${candidate.slug}`).toBe(candidate.page_count);
    // None of them carries a collection, so the site has none either.
    expect(await data<unknown[]>(await api.get('/ycode/api/collections')), candidate.slug).toEqual([]);
  }
});
