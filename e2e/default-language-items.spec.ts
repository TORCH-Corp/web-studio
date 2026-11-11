/**
 * Part 3, session W12 "done when": "make this language the default" also swaps the text of the site's collection items
 * (OPEN_QUESTIONS 24c).
 *
 * A site with English as its default has a People collection of five items. Their values are English; the Arabic is in
 * translations: Sara and Omar are translated and completed (Sara's rich text Bio too), Hala's address is translated as
 * well, Zaid's Arabic name is not completed, Lina has none. The list page (on the home page) and the item page
 * (`/{slug}`) show each person's name and role. The default moves to Arabic in Site settings and the site is
 * published: the default address reads Arabic and /en reads English, an item with no completed Arabic keeps its
 * English text on both and loses none of it; changing back and publishing restores the first state, row for row.
 * Until the next publish a visitor still reads the first state (the published rows are not touched). A change that
 * fails part way (a trigger makes the last write of the transaction fail) leaves values, translations and the default
 * flag as they were.
 */

import { expect, test, type APIRequestContext } from '@playwright/test';
import knex, { type Knex } from 'knex';
import { generateCollectionItemContentHash } from '../lib/hash-utils';
import { createSite, draftPages, openSite, publish, publishedSite, signIn, TEST_SITES_DOMAIN, type SiteRecord } from './helpers';

test.describe.configure({ mode: 'serial' });

const RUN = Date.now().toString(36);
const ORG = 'e3e3e3e3-e3e3-4e3e-8e3e-e3e3e3e3e3e3';
const USER = { sub: 'e4e4e4e4-e4e4-4e4e-8e4e-e4e4e4e4e4e4', email: 'owner-default-language-items@example.com', name: 'Owner', org: ORG };
const SLUG = `dli-${RUN}`;
const HOST = `${SLUG}.${TEST_SITES_DOMAIN}`;

interface Person { name: string; slug: string; role: string; bio?: string; ar?: { name?: string; slug?: string; role?: string; bio?: string; nameCompleted?: boolean } }
/** A rich text field's value is a document stored as JSON text; it must come through the swap byte for byte. */
const doc = (text: string) => JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: `${text} "quoted", back\\slash, {braces}, [list]` }] }] });
/** Sara and Omar are translated in full; Zaid's Arabic name was written but never completed; Lina has no Arabic at all. */
const SARA: Person = { name: 'Sara Ali', slug: 'sara-ali', role: 'Designer', bio: doc('Designs things'), ar: { name: 'سارة علي', role: 'مصممة', bio: doc('تصمم الأشياء') } };
const OMAR: Person = { name: 'Omar Hassan', slug: 'omar-hassan', role: 'Engineer', ar: { name: 'عمر حسن', role: 'مهندس' } };
const ZAID: Person = { name: 'Zaid Karim', slug: 'zaid-karim', role: 'Analyst', ar: { name: 'زيد كريم', nameCompleted: false } };
const LINA: Person = { name: 'Lina Noor', slug: 'lina-noor', role: 'Writer' };
/** Hala's address is translated too: her page is at /hala-saad in English and at /hala-ar in Arabic. */
const HALA: Person = { name: 'Hala Saad', slug: 'hala-saad', role: 'Editor', ar: { name: 'هالة سعد', slug: 'hala-ar', role: 'محررة' } };
const PEOPLE = [SARA, OMAR, ZAID, LINA, HALA];

interface Field { id: string; key: string | null; name: string; type: string }
interface Item { id: string; values: Record<string, string> }
interface Layer { id: string; name: string; classes?: string; settings?: unknown; variables?: unknown; children?: Layer[] }

let baseURL: string;
let db: Knex;
let api: APIRequestContext;
let site: SiteRecord;
let people: { id: string };
let fields: { name: Field; slug: Field; role: Field; bio: Field };
let items: Item[];
let locales: Array<{ id: string; code: string }>;
const guard = `ws_fail_${RUN}`;

async function ok<T>(response: Promise<import('@playwright/test').APIResponse>, status = 200): Promise<T> {
  const r = await response;
  expect(r.status(), await r.text()).toBe(status);
  return (await r.json()).data as T;
}

async function itemsOf(): Promise<Item[]> {
  const r = await api.get(`/ycode/api/collections/${people.id}/items?limit=50`);
  expect(r.status(), await r.text()).toBe(200);
  return (await r.json()).data.items as Item[];
}

async function createItem(values: Record<string, string>): Promise<Item> {
  const created = await ok<Item>(api.post(`/ycode/api/collections/${people.id}/items`, { data: { values } }), 201);
  // The item row is written first and its values after it: read it back whole.
  await expect.poll(async () => Object.keys((await itemsOf()).find((item) => item.id === created.id)?.values ?? {}).length, { timeout: 15_000 }).toBeGreaterThanOrEqual(Object.keys(values).length);
  return (await itemsOf()).find((item) => item.id === created.id)!;
}

const localeId = (code: string) => locales.find((locale) => locale.code === code)!.id;

async function translate(itemId: string, field: Field, value: string, isCompleted: boolean): Promise<void> {
  await ok(api.post('/ycode/api/translations', {
    data: { locale_id: localeId('ar'), source_type: 'cms', source_id: itemId, content_key: field.key ? `field:key:${field.key}` : `field:id:${field.id}`, content_type: field.type === 'rich_text' ? 'richtext' : 'text', content_value: value, is_completed: isCompleted },
  }), 201);
}

const variable = (field: Field, source: 'collection' | 'page', layerId?: string) => ({
  type: 'dynamicVariable',
  attrs: { label: field.name, variable: { type: 'field', data: { source, field_id: field.id, field_type: field.type, relationships: [], ...(layerId ? { collection_layer_id: layerId } : {}) } } },
});
const text = (id: string, tag: string, ...parts: Array<ReturnType<typeof variable> | { type: 'text'; text: string }>): Layer => ({
  id, name: tag.startsWith('h') ? 'heading' : 'text', settings: { tag }, classes: '', children: [],
  variables: { text: { type: 'dynamic_rich_text', data: { content: { type: 'doc', content: [{ type: 'paragraph', content: parts }] } } } },
});

async function saveLayers(pageId: string, children: Layer[]): Promise<void> {
  const r = await api.put(`/ycode/api/layers?page_id=${pageId}`, { data: { layers: [{ id: 'body', name: 'body', classes: '', children }] } });
  expect(r.status(), await r.text()).toBe(200);
}

/** What a visitor gets for a path on the site. */
async function visit(path: string): Promise<{ status: number; html: string }> {
  const visitor = await publishedSite(baseURL, HOST);
  try {
    const response = await visitor.get(path);
    return { status: response.status(), html: await response.text() };
  } finally {
    await visitor.dispose();
  }
}
/** The page's body, with the comments React puts between two text nodes taken out, so "Name / Role" reads as one string. */
const bodyOf = (html: string) => html.slice(html.indexOf('<body')).replace(/<!-- -->/g, '');

/** Each item's content hash is that of its own values (ycode keeps it so; publish compares it), in the drafts and in the published rows. */
async function expectHashesMatchValues(isPublished: boolean): Promise<void> {
  const rows = await db('collection_items').where({ tenant_id: site.id, is_published: isPublished }).whereNull('deleted_at').select('id', 'content_hash');
  expect(rows).toHaveLength(PEOPLE.length);
  for (const item of rows) {
    const values = await db('collection_item_values').where({ tenant_id: site.id, item_id: item.id, is_published: isPublished }).whereNull('deleted_at').select('field_id', 'value');
    expect(item.content_hash, `the ${isPublished ? 'published' : 'draft'} hash of item ${item.id}`).toBe(generateCollectionItemContentHash(values));
  }
}

const patch = (default_language: 'ar' | 'en') => api.patch(`/ycode/api/platform/sites/${site.id}/settings`, { data: { languages: ['ar', 'en'], default_language } });

/** The site's draft rows that the swap may change, without ids and times: values by item and field, live cms translations, the default flag. */
async function draftState() {
  const fieldKey = new Map<string, string>([[fields.name.id, 'name'], [fields.slug.id, 'slug'], [fields.role.id, 'role'], [fields.bio.id, 'bio']]);
  const values = await db('collection_item_values').where({ tenant_id: site.id, is_published: false }).whereNull('deleted_at').select('item_id', 'field_id', 'value');
  const code = new Map(locales.map((locale) => [locale.id, locale.code]));
  const translations = await db('translations').where({ tenant_id: site.id, is_published: false, source_type: 'cms' }).whereNull('deleted_at').select('locale_id', 'source_id', 'content_key', 'content_value', 'is_completed');
  const slugOf = (itemId: string) => values.find((row) => row.item_id === itemId && row.field_id === fields.slug.id)?.value ?? '?';
  return {
    values: values.map((row) => `${slugOf(row.item_id)} ${fieldKey.get(row.field_id)} = ${row.value}`).sort(),
    translations: translations.map((row) => `${code.get(row.locale_id)} ${slugOf(row.source_id)} ${row.content_key.replace('field:key:', '').replace(`field:id:${fields.role.id}`, 'role').replace(`field:id:${fields.bio.id}`, 'bio')} = ${row.content_value} (${row.is_completed ? 'complete' : 'incomplete'})`).sort(),
    defaults: (await db('locales').where({ tenant_id: site.id, is_published: false, is_default: true }).whereNull('deleted_at').select('code')).map((row) => row.code as string),
  };
}

test.beforeAll(async ({ baseURL: configured }) => {
  baseURL = configured!;
  db = knex({ client: 'pg', connection: process.env.DATABASE_URL_TEST });
  api = await signIn(baseURL, USER);
});

test.afterAll(async () => {
  await db?.raw(`DROP TRIGGER IF EXISTS ${guard} ON locales`).catch(() => undefined);
  await db?.raw(`DROP FUNCTION IF EXISTS ${guard}()`).catch(() => undefined);
  if (site) await api?.delete(`/ycode/api/platform/sites/${site.id}`);
  await api?.dispose();
  await db?.destroy();
});

test('a site whose default is English, with five people: a list page and an item page, published', async () => {
  site = await createSite(api, { name: 'Default language items', slug: SLUG, languages: ['en', 'ar'], default_language: 'en' });
  expect((await openSite(api, site.id)).status()).toBe(303);
  locales = await ok<Array<{ id: string; code: string }>>(api.get('/ycode/api/locales'));

  const collection = await ok<{ id: string }>(api.post('/ycode/api/collections', { data: { name: 'People' } }), 201);
  people = collection;
  const made: Field[] = [];
  for (const [index, field] of [{ name: 'Name', key: 'name', type: 'text' }, { name: 'Slug', key: 'slug', type: 'text' }, { name: 'Role', type: 'text' }, { name: 'Bio', type: 'rich_text' }].entries()) {
    made.push(await ok<Field>(api.post(`/ycode/api/collections/${collection.id}/fields`, { data: { ...field, order: index + 1 } }), 201));
  }
  fields = { name: made[0], slug: made[1], role: made[2], bio: made[3] };

  items = [];
  for (const person of PEOPLE) items.push(await createItem({ [fields.name.id]: person.name, [fields.slug.id]: person.slug, [fields.role.id]: person.role, ...(person.bio ? { [fields.bio.id]: person.bio } : {}) }));
  for (const [index, person] of PEOPLE.entries()) {
    if (person.ar?.name) await translate(items[index].id, fields.name, person.ar.name, person.ar.nameCompleted !== false);
    if (person.ar?.role) await translate(items[index].id, fields.role, person.ar.role, true);
    if (person.ar?.slug) await translate(items[index].id, fields.slug, person.ar.slug, true);
    if (person.ar?.bio) await translate(items[index].id, fields.bio, person.ar.bio, true);
  }

  const home = (await draftPages(api)).find((page) => page.is_index)!;
  const member = await ok<{ id: string }>(api.post('/ycode/api/pages', { data: { name: 'Person', slug: '*', is_dynamic: true, is_published: false, is_publishable: true, settings: { cms: { collection_id: collection.id, slug_field_id: fields.slug.id } } } }));
  await saveLayers(home.id, [{
    id: 'people-list', name: 'div', classes: '', variables: { collection: { id: collection.id, sort_by: fields.name.id, sort_order: 'asc' } },
    children: [text('person-line', 'h2', variable(fields.name, 'collection', 'people-list'), { type: 'text', text: ' / ' }, variable(fields.role, 'collection', 'people-list'))],
  }]);
  await saveLayers(member.id, [text('member-name', 'h1', variable(fields.name, 'page')), text('member-role', 'p', variable(fields.role, 'page'))]);
  await publish(api);
});

/** The first state: English at the default address, Arabic at /ar, each item on its own page. */
async function expectEnglishFirst(): Promise<void> {
  const root = await visit('/');
  expect(root.status).toBe(200);
  expect(root.html).toContain('dir="ltr"');
  for (const person of PEOPLE) expect(bodyOf(root.html)).toContain(`${person.name} / ${person.role}`);

  const arabic = await visit('/ar');
  expect(arabic.html).toContain('dir="rtl"');
  expect(bodyOf(arabic.html)).toContain(`${SARA.ar!.name} / ${SARA.ar!.role}`);
  expect(bodyOf(arabic.html)).toContain(`${OMAR.ar!.name} / ${OMAR.ar!.role}`);
  // Zaid's Arabic name was never completed: the Arabic address shows his English name, and Lina has no Arabic at all.
  expect(bodyOf(arabic.html)).toContain(`${ZAID.name} / ${ZAID.role}`);
  expect(bodyOf(arabic.html)).toContain(`${LINA.name} / ${LINA.role}`);
  expect(bodyOf(arabic.html)).not.toContain(ZAID.ar!.name!);
  expect(bodyOf(arabic.html)).toContain(`${HALA.ar!.name} / ${HALA.ar!.role}`);
  // An address that is translated too: English at /hala-saad, Arabic at /ar/hala-ar.
  const halaEnglish = await visit(`/${HALA.slug}`);
  expect(halaEnglish.status).toBe(200);
  expect(bodyOf(halaEnglish.html)).toContain(HALA.name);
  const halaArabic = await visit(`/ar/${HALA.ar!.slug}`);
  expect(halaArabic.status).toBe(200);
  expect(bodyOf(halaArabic.html)).toContain(HALA.ar!.name!);

  for (const person of [SARA, OMAR]) {
    const english = await visit(`/${person.slug}`);
    expect(english.status, person.slug).toBe(200);
    expect(bodyOf(english.html)).toContain(person.name);
    expect(bodyOf(english.html)).toContain(person.role);
    const inArabic = await visit(`/ar/${person.slug}`);
    expect(inArabic.status, `ar ${person.slug}`).toBe(200);
    expect(bodyOf(inArabic.html)).toContain(person.ar!.name!);
    expect(bodyOf(inArabic.html)).toContain(person.ar!.role!);
    expect(bodyOf(inArabic.html)).not.toContain(person.name);
  }
}

/** The second state: Arabic at the default address, English at /en; an item with no completed Arabic keeps its English on both. */
async function expectArabicFirst(): Promise<void> {
  const root = await visit('/');
  expect(root.status).toBe(200);
  expect(root.html).toContain('dir="rtl"');
  for (const person of [SARA, OMAR]) {
    expect(bodyOf(root.html)).toContain(`${person.ar!.name} / ${person.ar!.role}`);
    expect(bodyOf(root.html)).not.toContain(person.name);
    expect(bodyOf(root.html)).not.toContain(person.role);
  }
  // What had no completed Arabic keeps its text, as a page's text does.
  expect(bodyOf(root.html)).toContain(`${ZAID.name} / ${ZAID.role}`);
  expect(bodyOf(root.html)).toContain(`${LINA.name} / ${LINA.role}`);
  expect(bodyOf(root.html)).not.toContain(ZAID.ar!.name!);

  const english = await visit('/en');
  expect(english.status).toBe(200);
  expect(english.html).toContain('dir="ltr"');
  for (const person of PEOPLE) {
    expect(bodyOf(english.html)).toContain(`${person.name} / ${person.role}`);
    if (person.ar?.role) expect(bodyOf(english.html)).not.toContain(person.ar.name!);
  }

  for (const person of [SARA, OMAR]) {
    const arabic = await visit(`/${person.slug}`);
    expect(arabic.status, person.slug).toBe(200);
    expect(bodyOf(arabic.html)).toContain(person.ar!.name!);
    expect(bodyOf(arabic.html)).toContain(person.ar!.role!);
    expect(bodyOf(arabic.html)).not.toContain(person.name);
    const inEnglish = await visit(`/en/${person.slug}`);
    expect(inEnglish.status, `en ${person.slug}`).toBe(200);
    expect(bodyOf(inEnglish.html)).toContain(person.name);
    expect(bodyOf(inEnglish.html)).toContain(person.role);
    expect(bodyOf(inEnglish.html)).not.toContain(person.ar!.name!);
  }
  for (const person of [ZAID, LINA]) {
    expect(bodyOf((await visit(`/${person.slug}`)).html)).toContain(person.name);
    expect(bodyOf((await visit(`/en/${person.slug}`)).html)).toContain(person.name);
  }
  // An address that is translated too follows the default: Arabic at /hala-ar, English at /en/hala-saad.
  expect(bodyOf(root.html)).toContain(`${HALA.ar!.name} / ${HALA.ar!.role}`);
  const halaArabic = await visit(`/${HALA.ar!.slug}`);
  expect(halaArabic.status).toBe(200);
  expect(bodyOf(halaArabic.html)).toContain(HALA.ar!.name!);
  const halaEnglish = await visit(`/en/${HALA.slug}`);
  expect(halaEnglish.status).toBe(200);
  expect(bodyOf(halaEnglish.html)).toContain(HALA.name);
  // The address the default had before is no longer one: the page's slug follows the language as a page's does.
  expect((await visit(`/${HALA.slug}`)).status).toBe(404);
}

let first: Awaited<ReturnType<typeof draftState>>;

test('in the first state each address reads its own language', async () => {
  await expectEnglishFirst();
  first = await draftState();
  expect(first.defaults).toEqual(['en']);
  expect(first.values).toContain(`${SARA.slug} name = ${SARA.name}`);
  expect(first.translations).toContain(`ar ${SARA.slug} name = ${SARA.ar!.name} (complete)`);
  expect(first.values).toContain(`${SARA.slug} bio = ${SARA.bio}`);
  await expectHashesMatchValues(false);
  await expectHashesMatchValues(true);
});

test('a change that fails part way changes nothing: values, translations and the default flag are as they were', async () => {
  // The last write of the change is the new default's flag: make it fail, after every other write has been made.
  await db.raw(`CREATE FUNCTION ${guard}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'the default flag cannot move (e2e)'; END $$`);
  await db.raw(`CREATE TRIGGER ${guard} BEFORE UPDATE ON locales FOR EACH ROW WHEN (NEW.is_default AND NEW.tenant_id = '${site.id}') EXECUTE FUNCTION ${guard}()`);
  try {
    const refused = await patch('ar');
    expect(refused.ok(), await refused.text()).toBe(false);
    expect(await draftState()).toEqual(first);
    const stored = await itemsOf();
    expect(stored.map((item) => item.values[fields.name.id]).sort()).toEqual(PEOPLE.map((person) => person.name).sort());
  } finally {
    await db.raw(`DROP TRIGGER IF EXISTS ${guard} ON locales`);
    await db.raw(`DROP FUNCTION IF EXISTS ${guard}()`);
  }
});

test('the default moves to Arabic: the drafts follow at once, and a visitor reads the first state until the next publish', async () => {
  const moved = await patch('ar');
  expect(moved.status(), await moved.text()).toBe(200);
  expect((await moved.json()).data.default_language).toBe('ar');

  // The drafts: each completed Arabic text is the item's value; what the values held is the English translation.
  const state = await draftState();
  expect(state.defaults).toEqual(['ar']);
  expect(state.values).toContain(`${SARA.slug} name = ${SARA.ar!.name}`);
  expect(state.values).toContain(`${SARA.slug} role = ${SARA.ar!.role}`);
  expect(state.values).toContain(`${OMAR.slug} name = ${OMAR.ar!.name}`);
  // A rich text is a document stored as text: it moves whole, and its English becomes the English translation as a rich text.
  expect(state.values).toContain(`${SARA.slug} bio = ${SARA.ar!.bio}`);
  expect(state.translations).toContain(`en ${SARA.slug} bio = ${SARA.bio} (complete)`);
  expect(state.values.filter((row) => row.startsWith(`${OMAR.slug} bio`))).toEqual([]);
  // No completed Arabic, so the text stays, and the unfinished Arabic stays where it was.
  expect(state.values).toContain(`${ZAID.slug} name = ${ZAID.name}`);
  expect(state.values).toContain(`${LINA.slug} name = ${LINA.name}`);
  expect(state.values).toContain(`${LINA.slug} role = ${LINA.role}`);
  expect(state.translations).toContain(`en ${SARA.slug} name = ${SARA.name} (complete)`);
  expect(state.translations).toContain(`en ${SARA.slug} role = ${SARA.role} (complete)`);
  expect(state.translations).toContain(`ar ${ZAID.slug} name = ${ZAID.ar!.name} (incomplete)`);
  expect(state.translations.filter((row) => row.includes(` ${LINA.slug} `))).toEqual([]);
  expect(state.translations.filter((row) => row.startsWith('ar ') && row.includes(` ${SARA.slug} `))).toEqual([]);
  await expectHashesMatchValues(false);

  // The published rows are not touched until the next publish: a visitor still reads the first state.
  await expectEnglishFirst();
});

test('after the next publish the default address reads Arabic and /en reads English', async () => {
  await publish(api);
  await expectArabicFirst();
  await expectHashesMatchValues(false);
  await expectHashesMatchValues(true);
});

test('changing back restores the first state, in the rows and on the site', async () => {
  const moved = await patch('en');
  expect(moved.status(), await moved.text()).toBe(200);
  expect((await moved.json()).data.default_language).toBe('en');
  expect(await draftState()).toEqual(first);
  await expectHashesMatchValues(false);

  await publish(api);
  await expectEnglishFirst();
  await expectHashesMatchValues(true);
});
