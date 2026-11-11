/**
 * Part 3, session W11 "done when": a site made from a template gets the template's collections.
 *
 * A template in the templates organization has two collections: People (a list on the home page, an item page, a
 * link to one item, a select that takes its options from the collection, an image field) and Posts, whose Author field
 * refers to People and whose list page shows the author's name. Both have items with English values and Arabic
 * translations; a third person was deleted, and a translation of hers is left live, as a failed cascade would leave
 * it. A site made from the template (with Arabic and English, English the default) shows both collections' items on
 * its published pages, each person on her own page, in both languages; a site whose default language is Arabic shows
 * the Arabic text first; changing an item in the site does not change the template and the reverse; no row of the
 * site holds an id of the template; a site made before the template had collections, and a blank site, have none;
 * and a template with a pointer that cannot be followed refuses the copy by name and leaves no site.
 */

import { expect, test, type APIRequestContext } from '@playwright/test';
import knex, { type Knex } from 'knex';
import { generateCollectionItemContentHash } from '../lib/hash-utils';
import { createSite, draftPages, listSites, openSite, publish, publishedSite, signIn, TEMPLATES_ORG, TEST_SITES_DOMAIN, type SiteRecord } from './helpers';

test.describe.configure({ mode: 'serial' });

const RUN = Date.now().toString(36);
const ORG_A = 'd6d6d6d6-d6d6-4d6d-8d6d-d6d6d6d6d6d6';
const USER_T = { sub: 'd7d7d7d7-d7d7-4d7d-8d7d-d7d7d7d7d7d7', email: 'template-collections@example.com', name: 'Template Builder', org: TEMPLATES_ORG };
const USER_A = { sub: 'd8d8d8d8-d8d8-4d8d-8d8d-d8d8d8d8d8d8', email: 'owner-template-collections@example.com', name: 'Owner', org: ORG_A };
const BLANK_TEMPLATE_ID = 'c0a8e7d6-0000-4000-8000-000000000003';
const HOST = (name: string) => `tc-${name}-${RUN}.${TEST_SITES_DOMAIN}`;
/** A 1x1 PNG: the template's asset, the photo of one person. */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

const PEOPLE = [
  { name: 'Sara Ali', slug: 'sara-ali', role: 'Designer', ar: { name: 'سارة علي', role: 'مصممة' } },
  { name: 'Omar Hassan', slug: 'omar-hassan', role: 'Engineer', ar: { name: 'عمر حسن', role: 'مهندس' } },
];
const POSTS = [
  { title: 'Opening day', slug: 'opening-day', author: 0, ar: 'يوم الافتتاح' },
  { title: 'New branch', slug: 'new-branch', author: 1, ar: 'فرع جديد' },
];
const GONE = { name: 'Zed Gone', slug: 'zed-gone', role: 'Left', ar: { name: 'زيد' } };

interface Field { id: string; key: string | null; name: string; type: string }
interface Item { id: string; values: Record<string, string> }
interface Collection { id: string; name: string; uuid?: string }
interface Layer { id: string; name: string; classes?: string; settings?: unknown; variables?: unknown; children?: Layer[] }

/** The template's rows, by the names the spec uses. */
interface Fixture {
  site: SiteRecord;
  people: Collection;
  posts: Collection;
  personFields: Record<'name' | 'slug' | 'role' | 'photo', Field>;
  postFields: Record<'title' | 'slug' | 'author', Field>;
  personItems: Item[];
  postItems: Item[];
  goneId: string;
  assetId: string;
  homeId: string;
  memberPageId: string;
  postsPageId: string;
}

let baseURL: string;
let db: Knex;
let templates: APIRequestContext;
let orgA: APIRequestContext;
let fx: Fixture;
/** A site made before the template had collections. */
let early: SiteRecord;
let copy: SiteRecord;
let arabicFirst: SiteRecord;
const toDelete: Array<{ api: () => APIRequestContext; site: SiteRecord }> = [];

async function ok<T>(response: Promise<import('@playwright/test').APIResponse>, status = 200): Promise<T> {
  const r = await response;
  expect(r.status(), await r.text()).toBe(status);
  return (await r.json()).data as T;
}

const collectionsOf = (api: APIRequestContext) => ok<Collection[]>(api.get('/ycode/api/collections'));
const fieldsOf = (api: APIRequestContext, id: string) => ok<Field[]>(api.get(`/ycode/api/collections/${id}/fields`));
async function itemsOf(api: APIRequestContext, id: string): Promise<Item[]> {
  const r = await api.get(`/ycode/api/collections/${id}/items?limit=50`);
  expect(r.status(), await r.text()).toBe(200);
  return (await r.json()).data.items as Item[];
}

async function createCollection(api: APIRequestContext, name: string, fields: Array<{ name: string; key?: string; type: string; reference_collection_id?: string }>): Promise<{ collection: Collection; fields: Field[] }> {
  const collection = await ok<Collection>(api.post('/ycode/api/collections', { data: { name } }), 201);
  const made: Field[] = [];
  for (const [index, field] of fields.entries()) made.push(await ok<Field>(api.post(`/ycode/api/collections/${collection.id}/fields`, { data: { ...field, order: index + 1 } }), 201));
  return { collection, fields: made };
}

async function createItem(api: APIRequestContext, collectionId: string, values: Record<string, string>): Promise<Item> {
  const created = await ok<Item>(api.post(`/ycode/api/collections/${collectionId}/items`, { data: { values } }), 201);
  // The item row is written first and its values after it: read it back whole.
  await expect.poll(async () => Object.keys((await itemsOf(api, collectionId)).find((item) => item.id === created.id)?.values ?? {}).length, { timeout: 15_000 }).toBeGreaterThanOrEqual(Object.keys(values).length);
  return (await itemsOf(api, collectionId)).find((item) => item.id === created.id)!;
}

async function translate(api: APIRequestContext, localeId: string, itemId: string, field: Field, value: string): Promise<void> {
  await ok(api.post('/ycode/api/translations', {
    data: { locale_id: localeId, source_type: 'cms', source_id: itemId, content_key: field.key ? `field:key:${field.key}` : `field:id:${field.id}`, content_type: 'text', content_value: value, is_completed: true },
  }), 201);
}

const variable = (field: Field, source: 'collection' | 'page', layerId?: string, relationships: string[] = []) => ({
  type: 'dynamicVariable',
  attrs: { label: field.name, variable: { type: 'field', data: { source, field_id: field.id, field_type: field.type, relationships, ...(layerId ? { collection_layer_id: layerId } : {}) } } },
});
const text = (id: string, tag: string, ...parts: Array<ReturnType<typeof variable> | { type: 'text'; text: string }>): Layer => ({
  id, name: tag.startsWith('h') ? 'heading' : 'text', settings: { tag }, classes: '', children: [],
  variables: { text: { type: 'dynamic_rich_text', data: { content: { type: 'doc', content: [{ type: 'paragraph', content: parts }] } } } },
});

async function saveLayers(api: APIRequestContext, pageId: string, children: Layer[]): Promise<void> {
  const r = await api.put(`/ycode/api/layers?page_id=${pageId}`, { data: { layers: [{ id: 'body', name: 'body', classes: '', children }] } });
  expect(r.status(), await r.text()).toBe(200);
}

/** The HTML a visitor gets for a path on a site, by host, and its status. */
async function published(site: SiteRecord, path: string): Promise<{ status: number; html: string }> {
  const visitor = await publishedSite(baseURL, site.hosts[0]);
  try {
    const response = await visitor.get(path);
    return { status: response.status(), html: await response.text() };
  } finally {
    await visitor.dispose();
  }
}
/** The page's body, with the comments React puts between two text nodes taken out, so "Name / Role" reads as one string. */
const bodyOf = (html: string) => html.slice(html.indexOf('<body')).replace(/<!-- -->/g, '');

/** Every row of every table that has a tenant, as text, for one site. */
async function textOfSite(siteId: string): Promise<string> {
  const tables = (await db('information_schema.columns').where({ table_schema: 'public', column_name: 'tenant_id' }).select('table_name')).map((row) => row.table_name as string);
  const parts: string[] = [];
  for (const table of tables) parts.push(JSON.stringify(await db(table).where({ tenant_id: siteId })));
  return parts.join('\n');
}

/** Every id of a site's rows, in every state, and its collections' own uuid. */
async function idsOfSite(siteId: string): Promise<Set<string>> {
  const tables = (await db('information_schema.columns').where({ table_schema: 'public', column_name: 'tenant_id' }).select('table_name')).map((row) => row.table_name as string);
  const ids = new Set<string>([siteId]);
  for (const table of tables) {
    const hasId = await db('information_schema.columns').where({ table_schema: 'public', table_name: table, column_name: 'id' }).first();
    if (!hasId) continue;
    for (const row of await db(table).where({ tenant_id: siteId }).select('id')) ids.add(String(row.id));
  }
  for (const row of await db('collections').where({ tenant_id: siteId }).select('uuid')) ids.add(String(row.uuid));
  return ids;
}

test.beforeAll(async ({ baseURL: configured }) => {
  baseURL = configured!;
  db = knex({ client: 'pg', connection: process.env.DATABASE_URL_TEST });
  templates = await signIn(baseURL, USER_T);
  orgA = await signIn(baseURL, USER_A);
});

test.afterAll(async () => {
  // A template left behind would show in the Templates list of the specs after this one.
  for (const { api, site } of toDelete) await api().delete(`/ycode/api/platform/sites/${site.id}`);
  await templates?.dispose();
  await orgA?.dispose();
  await db?.destroy();
});

test('the template: two collections (the second refers to the first), items in English and Arabic, a list page, an item page, a link, a select and a photo', async () => {
  const site = await createSite(templates, { name: 'Template with collections', slug: `tc-tpl-${RUN}`, languages: ['en', 'ar'], default_language: 'en', is_template: true, template: { name: { en: 'Template with collections' } } });
  toDelete.push({ api: () => templates, site });
  expect((await openSite(templates, site.id)).status()).toBe(303);

  // A site made before the template has collections: it never gets them (PRD "A site made before part 3 has no ready collections").
  early = await createSite(orgA, { name: 'Made before', slug: `tc-early-${RUN}`, languages: ['en', 'ar'], default_language: 'en', hosts: [HOST('early')], template_id: site.id });
  toDelete.push({ api: () => orgA, site: early });

  const people = await createCollection(templates, 'People', [{ name: 'Name', key: 'name', type: 'text' }, { name: 'Slug', key: 'slug', type: 'text' }, { name: 'Role', type: 'text' }, { name: 'Photo', type: 'image' }]);
  const [name, slug, role, photo] = people.fields;
  const posts = await createCollection(templates, 'Posts', [{ name: 'Title', key: 'name', type: 'text' }, { name: 'Slug', key: 'slug', type: 'text' }, { name: 'Author', type: 'reference', reference_collection_id: people.collection.id }]);
  const [title, postSlug, author] = posts.fields;

  const uploaded = await templates.post('/ycode/api/assets', { multipart: { file: { name: 'photo.png', mimeType: 'image/png', buffer: PNG }, source: 'file-manager' } });
  expect(uploaded.ok(), await uploaded.text()).toBe(true);
  const assetId = ((await uploaded.json()).data as { id: string }).id;

  const personItems: Item[] = [];
  for (const [index, person] of PEOPLE.entries()) {
    personItems.push(await createItem(templates, people.collection.id, { [name.id]: person.name, [slug.id]: person.slug, [role.id]: person.role, ...(index === 0 ? { [photo.id]: assetId } : {}) }));
  }
  const gone = await createItem(templates, people.collection.id, { [name.id]: GONE.name, [slug.id]: GONE.slug, [role.id]: GONE.role });
  const postItems: Item[] = [];
  for (const post of POSTS) postItems.push(await createItem(templates, posts.collection.id, { [title.id]: post.title, [postSlug.id]: post.slug, [author.id]: personItems[post.author].id }));

  const locales = await ok<Array<{ id: string; code: string }>>(templates.get('/ycode/api/locales'));
  const arabic = locales.find((locale) => locale.code === 'ar')!;
  for (const [index, person] of PEOPLE.entries()) {
    await translate(templates, arabic.id, personItems[index].id, name, person.ar.name);
    await translate(templates, arabic.id, personItems[index].id, role, person.ar.role);
  }
  for (const [index, post] of POSTS.entries()) await translate(templates, arabic.id, postItems[index].id, title, post.ar);
  // A deleted person: ycode deletes her translations with her. Put one back, as a cascade that failed part way would
  // have left it, so the copy meets a live translation of an item that is not live and leaves it behind.
  await translate(templates, arabic.id, gone.id, name, GONE.ar.name);
  expect((await templates.delete(`/ycode/api/collections/${people.collection.id}/items/${gone.id}`)).status()).toBe(200);
  expect(await db('translations').where({ tenant_id: site.id, source_type: 'cms', source_id: gone.id }).update({ deleted_at: null })).toBe(1);

  const pages = await draftPages(templates);
  const home = pages.find((page) => page.is_index)!;
  const member = await ok<{ id: string }>(templates.post('/ycode/api/pages', { data: { name: 'Person', slug: '*', is_dynamic: true, is_published: false, is_publishable: true, settings: { cms: { collection_id: people.collection.id, slug_field_id: slug.id } } } }));
  const postsPage = await ok<{ id: string }>(templates.post('/ycode/api/pages', { data: { name: 'Posts', slug: 'posts' } }));

  await saveLayers(templates, home.id, [
    {
      id: 'people-list', name: 'div', classes: '', variables: { collection: { id: people.collection.id, sort_by: name.id, sort_order: 'asc' } },
      children: [text('person-line', 'h2', variable(name, 'collection', 'people-list'), { type: 'text', text: ' / ' }, variable(role, 'collection', 'people-list'))],
    },
    { id: 'sara-link', name: 'a', classes: '', variables: { link: { type: 'page', page: { id: member.id, collection_item_id: personItems[0].id } } }, children: [text('sara-link-text', 'p', { type: 'text', text: 'Meet Sara' })] },
    { id: 'person-pick', name: 'select', classes: '', settings: { optionsSource: { collectionId: people.collection.id, defaultItemId: personItems[0].id, sortFieldId: name.id } }, children: [] },
  ]);
  await saveLayers(templates, member.id, [text('member-name', 'h1', variable(name, 'page')), text('member-role', 'p', variable(role, 'page'))]);
  // The author's name goes through the reference: field_id is the reference field on the post, the relationship the field on People.
  const authorName = { type: 'dynamicVariable', attrs: { label: 'Author Name', variable: { type: 'field', data: { source: 'collection', field_id: author.id, field_type: 'reference', relationships: [name.id], collection_layer_id: 'posts-list' } } } };
  await saveLayers(templates, postsPage.id, [
    {
      id: 'posts-list', name: 'div', classes: '', variables: { collection: { id: posts.collection.id, sort_by: title.id, sort_order: 'asc' } },
      children: [text('post-line', 'h2', variable(title, 'collection', 'posts-list')), text('post-author', 'p', authorName as unknown as ReturnType<typeof variable>)],
    },
  ]);

  fx = {
    site, people: people.collection, posts: posts.collection,
    personFields: { name, slug, role, photo }, postFields: { title, slug: postSlug, author },
    personItems, postItems, goneId: gone.id, assetId, homeId: home.id, memberPageId: member.id, postsPageId: postsPage.id,
  };
  expect(await collectionsOf(templates)).toHaveLength(2);
  expect(await itemsOf(templates, people.collection.id)).toHaveLength(2);
});

test('a site made from the template has its collections, fields, items and values, with new ids', async () => {
  copy = await createSite(orgA, { name: 'Made from the template', slug: `tc-copy-${RUN}`, languages: ['en', 'ar'], default_language: 'en', hosts: [HOST('copy')], template_id: fx.site.id });
  toDelete.push({ api: () => orgA, site: copy });
  expect((await openSite(orgA, copy.id)).status()).toBe(303);

  const collections = await collectionsOf(orgA);
  expect(collections.map((collection) => collection.name).sort()).toEqual(['People', 'Posts']);
  for (const collection of collections) expect([fx.people.id, fx.posts.id]).not.toContain(collection.id);
  const people = collections.find((collection) => collection.name === 'People')!;
  const posts = collections.find((collection) => collection.name === 'Posts')!;

  const personFields = await fieldsOf(orgA, people.id);
  expect(personFields.filter((field) => ['Name', 'Slug', 'Role', 'Photo'].includes(field.name)).map((field) => `${field.name}:${field.type}:${field.key}`).sort()).toEqual(['Name:text:name', 'Photo:image:null', 'Role:text:null', 'Slug:text:slug']);
  const postFields = await fieldsOf(orgA, posts.id);
  const author = postFields.find((field) => field.name === 'Author')!;
  expect(author).toMatchObject({ type: 'reference', reference_collection_id: people.id });

  const copiedPeople = await itemsOf(orgA, people.id);
  const nameField = personFields.find((field) => field.name === 'Name')!;
  const roleField = personFields.find((field) => field.name === 'Role')!;
  expect(copiedPeople.map((item) => item.values[nameField.id]).sort()).toEqual(PEOPLE.map((person) => person.name).sort());
  expect(copiedPeople.map((item) => item.values[roleField.id]).sort()).toEqual(PEOPLE.map((person) => person.role).sort());
  expect(copiedPeople.map((item) => item.values[nameField.id])).not.toContain(GONE.name);
  for (const item of copiedPeople) expect(fx.personItems.map((original) => original.id)).not.toContain(item.id);

  // A reference follows the item: the post's author is the copy's person.
  const copiedPosts = await itemsOf(orgA, posts.id);
  expect(copiedPosts).toHaveLength(2);
  for (const post of POSTS) {
    const copiedPost = copiedPosts.find((item) => item.values[postFields.find((field) => field.name === 'Title')!.id] === post.title)!;
    const authorItem = copiedPeople.find((item) => item.id === copiedPost.values[author.id])!;
    expect(authorItem.values[nameField.id], post.title).toBe(PEOPLE[post.author].name);
  }

  // The photo: the value is the copy's asset, which has its file.
  const photoField = personFields.find((field) => field.name === 'Photo')!;
  const photoValue = copiedPeople.find((item) => item.values[nameField.id] === PEOPLE[0].name)!.values[photoField.id];
  const assets = await ok<Array<{ id: string; filename: string; public_url: string }>>(orgA.get('/ycode/api/assets'));
  expect(assets.map((asset) => asset.id)).toContain(photoValue);
  expect(photoValue).not.toBe(fx.assetId);
  const file = assets.find((asset) => asset.id === photoValue)!;
  expect(file.public_url).toContain(`/platform-storage/${copy.id}/`);
  expect((await orgA.get(file.public_url)).status()).toBe(200);

  // The rows are drafts until the first publish, as the pages are.
  expect(await db('collections').where({ tenant_id: copy.id, is_published: true })).toHaveLength(0);
  expect(await db('collections').where({ tenant_id: copy.id, is_published: false })).toHaveLength(2);
  expect(await db('collection_items').where({ tenant_id: copy.id, is_published: true })).toHaveLength(0);
  expect(await db('collection_items').where({ tenant_id: copy.id, is_published: false })).toHaveLength(4);
  // Each item's content hash is that of its own values (the first publish and the builder's "changed" mark read it): the
  // hash covers the field ids, which are the site's.
  for (const item of await db('collection_items').where({ tenant_id: copy.id, is_published: false })) {
    const values = await db('collection_item_values').where({ tenant_id: copy.id, item_id: item.id, is_published: false }).whereNull('deleted_at').select('field_id', 'value');
    expect(item.content_hash, `the hash of item ${item.id}`).toBe(generateCollectionItemContentHash(values));
  }
  // The Arabic translations came with the items; the deleted person's was left behind.
  const arabic = (await db('locales').where({ tenant_id: copy.id, code: 'ar' }).first()).id;
  const translated = await db('translations').where({ tenant_id: copy.id, locale_id: arabic, source_type: 'cms' }).select('source_id', 'content_value');
  expect(translated.map((row) => row.content_value).sort()).toEqual([...PEOPLE.flatMap((person) => [person.ar.name, person.ar.role]), ...POSTS.map((post) => post.ar)].sort());
  expect(translated.map((row) => row.content_value)).not.toContain(GONE.ar.name);
  const copiedIds = new Set([...copiedPeople, ...copiedPosts].map((item) => item.id));
  for (const row of translated) expect(copiedIds.has(row.source_id), `a translation of ${row.source_id} follows an item of the copy`).toBe(true);
});

test('no row of the site holds an id of the template, and no row of the template an id of the site', async () => {
  const templateIds = await idsOfSite(fx.site.id);
  expect(templateIds.size).toBeGreaterThan(30);
  const siteText = await textOfSite(copy.id);
  const kept = [...templateIds].filter((id) => siteText.toLowerCase().includes(id.toLowerCase()));
  expect(kept, 'ids of the template found in the site\'s rows').toEqual([]);

  const siteIds = await idsOfSite(copy.id);
  const templateText = (await textOfSite(fx.site.id)).toLowerCase();
  expect([...siteIds].filter((id) => id !== copy.id && templateText.includes(id.toLowerCase())), 'ids of the site found in the template\'s rows').toEqual([]);

  // Each copied collection has its own uuid (a global unique column).
  const uuids = await db('collections').whereIn('tenant_id', [fx.site.id, copy.id]).select('uuid');
  expect(new Set(uuids.map((row) => row.uuid)).size).toBe(4);
});

/** The layer with this id, anywhere in a tree of layers. */
function layerNamed(layers: Layer[], id: string): Layer {
  for (const layer of layers) {
    if (layer.id === id) return layer;
    const inside = layer.children ? layerNamed(layer.children, id) : undefined;
    if (inside) return inside;
  }
  return undefined as unknown as Layer;
}

test('the pages point at the site\'s collections, fields and items', async () => {
  const people = (await collectionsOf(orgA)).find((collection) => collection.name === 'People')!;
  const posts = (await collectionsOf(orgA)).find((collection) => collection.name === 'Posts')!;
  const personFields = await fieldsOf(orgA, people.id);
  const postFields = await fieldsOf(orgA, posts.id);
  const nameField = personFields.find((field) => field.name === 'Name')!;
  const sara = (await itemsOf(orgA, people.id)).find((item) => item.values[nameField.id] === PEOPLE[0].name)!;

  const pages = await draftPages(orgA);
  const member = pages.find((page) => page.slug === '*')!;
  expect(member.id).not.toBe(fx.memberPageId);
  const layersOf = async (pageId: string) => (await ok<{ layers: Layer[] }>(orgA.get(`/ycode/api/layers?page_id=${pageId}&is_published=false`))).layers;

  // A Collection element's source and sort field, a link to one item (and the copy's own item page), an option source.
  const home = await layersOf(pages.find((page) => page.is_index)!.id);
  expect(layerNamed(home, 'people-list').variables).toMatchObject({ collection: { id: people.id, sort_by: nameField.id } });
  expect(layerNamed(home, 'sara-link').variables).toEqual({ link: { type: 'page', page: { id: member.id, collection_item_id: sara.id } } });
  expect(layerNamed(home, 'person-pick').settings).toMatchObject({ optionsSource: { collectionId: people.id, defaultItemId: sara.id, sortFieldId: nameField.id } });
  // Field variables inside a Collection element, bound to the element by its layer id.
  const line = JSON.stringify(layerNamed(home, 'person-line').variables);
  for (const name of ['Name', 'Role']) expect(line).toContain(personFields.find((field) => field.name === name)!.id);

  // A reference between collections: the post's author field, then the field on People.
  const postsPage = await layersOf(pages.find((page) => page.slug === 'posts')!.id);
  expect(layerNamed(postsPage, 'posts-list').variables).toMatchObject({ collection: { id: posts.id } });
  const author = layerNamed(postsPage, 'post-author').variables as { text: { data: { content: { content: Array<{ content: Array<{ attrs: { variable: { data: Record<string, unknown> } } }> }> } } } };
  expect(author.text.data.content.content[0].content[0].attrs.variable.data).toMatchObject({ field_id: postFields.find((field) => field.name === 'Author')!.id, relationships: [nameField.id] });

  // A CMS page's settings.
  const memberRow = await db('pages').where({ id: member.id, tenant_id: copy.id, is_published: false }).first();
  expect(memberRow.settings.cms).toEqual({ collection_id: people.id, slug_field_id: personFields.find((field) => field.name === 'Slug')!.id });
  const memberLayers = await layersOf(member.id);
  expect(JSON.stringify(layerNamed(memberLayers, 'member-name').variables)).toContain(nameField.id);
});

test('after the first publish a visitor reads both collections on the list pages and each person on her own page, in English and in Arabic', async () => {
  await publish(orgA);

  const list = await published(copy, '/');
  expect(list.status).toBe(200);
  for (const person of PEOPLE) expect(bodyOf(list.html)).toContain(`${person.name} / ${person.role}`);
  expect(bodyOf(list.html)).not.toContain(GONE.name);
  // The link to one item and the select's options are the copy's items.
  expect(bodyOf(list.html)).toContain('href="/sara-ali"');
  const personIds = (await db('collection_items').where({ tenant_id: copy.id, is_published: true }).select('id')).map((row) => row.id as string);
  expect(personIds.length).toBe(4);
  const options = [...bodyOf(list.html).matchAll(/<option[^>]*value="([0-9a-f-]{36})"/g)].map((match) => match[1]);
  expect(options).toHaveLength(2);
  for (const id of options) expect(personIds).toContain(id);
  for (const original of fx.personItems) expect(list.html).not.toContain(original.id);

  const arabicList = await published(copy, '/ar');
  expect(arabicList.status).toBe(200);
  for (const person of PEOPLE) {
    expect(bodyOf(arabicList.html)).toContain(`${person.ar.name} / ${person.ar.role}`);
    expect(bodyOf(arabicList.html)).not.toContain(person.name);
  }
  expect(arabicList.html).toMatch(/dir="rtl"/);

  for (const person of PEOPLE) {
    const english = await published(copy, `/${person.slug}`);
    expect(english.status, person.slug).toBe(200);
    expect(bodyOf(english.html)).toContain(person.name);
    expect(bodyOf(english.html)).toContain(person.role);
    for (const other of PEOPLE.filter((candidate) => candidate !== person)) expect(bodyOf(english.html)).not.toContain(other.name);
    const arabic = await published(copy, `/ar/${person.slug}`);
    expect(arabic.status, `ar ${person.slug}`).toBe(200);
    expect(bodyOf(arabic.html)).toContain(person.ar.name);
    expect(bodyOf(arabic.html)).toContain(person.ar.role);
    expect(bodyOf(arabic.html)).not.toContain(person.name);
  }
  expect((await published(copy, `/${GONE.slug}`)).status).toBe(404);

  // The second collection: its list page, and the name of each post's author through the reference.
  const posts = await published(copy, '/posts');
  expect(posts.status).toBe(200);
  for (const post of POSTS) {
    expect(bodyOf(posts.html)).toContain(post.title);
    expect(bodyOf(posts.html)).toContain(PEOPLE[post.author].name);
  }
  const arabicPosts = await published(copy, '/ar/posts');
  expect(arabicPosts.status).toBe(200);
  for (const post of POSTS) expect(bodyOf(arabicPosts.html)).toContain(post.ar);
});

test('changing an item in the site does not change the template, and the reverse', async () => {
  const people = (await collectionsOf(orgA)).find((collection) => collection.name === 'People')!;
  const personFields = await fieldsOf(orgA, people.id);
  const roleField = personFields.find((field) => field.name === 'Role')!;
  const nameField = personFields.find((field) => field.name === 'Name')!;
  const copiedSara = (await itemsOf(orgA, people.id)).find((item) => item.values[nameField.id] === PEOPLE[0].name)!;

  const changed = await orgA.put(`/ycode/api/collections/${people.id}/items/${copiedSara.id}`, { data: { values: { [roleField.id]: 'Art director' } } });
  expect(changed.status(), await changed.text()).toBe(200);
  const added = await createItem(orgA, people.id, { [nameField.id]: 'Added in the site', [personFields.find((field) => field.name === 'Slug')!.id]: 'added-in-the-site', [roleField.id]: 'Guest' });
  const templateRoleField = fx.personFields.role;
  const templateSara = (await itemsOf(templates, fx.people.id)).find((item) => item.id === fx.personItems[0].id)!;
  expect(templateSara.values[templateRoleField.id]).toBe('Designer');
  expect(await itemsOf(templates, fx.people.id)).toHaveLength(2);
  expect(await ok<Collection[]>(templates.get('/ycode/api/collections'))).toHaveLength(2);

  const edited = await templates.put(`/ycode/api/collections/${fx.people.id}/items/${fx.personItems[1].id}`, { data: { values: { [templateRoleField.id]: 'Changed in the template' } } });
  expect(edited.status(), await edited.text()).toBe(200);
  const afterwards = (await itemsOf(orgA, people.id)).find((item) => item.values[nameField.id] === PEOPLE[1].name)!;
  expect(afterwards.values[roleField.id]).toBe(PEOPLE[1].role);
  expect(((await itemsOf(orgA, people.id)).find((item) => item.id === copiedSara.id)!).values[roleField.id]).toBe('Art director');
  expect(added.id).not.toBe('');

  // On the published site too, once published again; the template is not published at all.
  await publish(orgA);
  const page = await published(copy, '/');
  expect(bodyOf(page.html)).toContain('Sara Ali / Art director');
  expect(bodyOf(page.html)).toContain('Omar Hassan / Engineer');
  expect(bodyOf(page.html)).toContain('Added in the site');
  expect(bodyOf(page.html)).not.toContain('Changed in the template');
});

test('a site made before the template had collections, and a blank site, have none', async () => {
  expect((await openSite(orgA, early.id)).status()).toBe(303);
  expect(await collectionsOf(orgA)).toEqual([]);
  expect(await db('collections').where({ tenant_id: early.id })).toHaveLength(0);
  expect(await db('collection_items').where({ tenant_id: early.id })).toHaveLength(0);
  await publish(orgA);
  expect((await published(early, '/')).status).toBe(200);

  for (const [slug, template_id] of [[`tc-b1-${RUN}`, BLANK_TEMPLATE_ID], [`tc-b2-${RUN}`, undefined]] as const) {
    const blank = await createSite(orgA, { name: 'Blank', slug, languages: ['en', 'ar'], default_language: 'en', template_id });
    toDelete.push({ api: () => orgA, site: blank });
    expect((await openSite(orgA, blank.id)).status()).toBe(303);
    expect(await collectionsOf(orgA)).toEqual([]);
    expect(await db('collection_items').where({ tenant_id: blank.id })).toHaveLength(0);
  }
});

test('a site whose default language is Arabic reads the items\' Arabic text as its own, and English at /en', async () => {
  // The template as it is now: an earlier test changed Omar's role in it, which ycode answers by marking its Arabic
  // translation incomplete (an incomplete translation is not applied). Complete it again, as the template's builder would.
  const now = PEOPLE.map((person, index) => ({ ...person, role: index === 1 ? 'Changed in the template' : person.role }));
  const templateArabic = (await ok<Array<{ id: string; code: string }>>(templates.get('/ycode/api/locales'))).find((locale) => locale.code === 'ar')!;
  const recompleted = await templates.post('/ycode/api/translations/bulk', {
    data: { translations: [{ locale_id: templateArabic.id, source_type: 'cms', source_id: fx.personItems[1].id, content_key: `field:id:${fx.personFields.role.id}`, content_type: 'text', content_value: PEOPLE[1].ar.role, is_completed: true }] },
  });
  expect(recompleted.status(), await recompleted.text()).toBe(201);
  arabicFirst = await createSite(orgA, { name: 'Arabic first', slug: `tc-ar-${RUN}`, languages: ['ar', 'en'], default_language: 'ar', hosts: [HOST('ar')], template_id: fx.site.id });
  toDelete.push({ api: () => orgA, site: arabicFirst });
  expect((await openSite(orgA, arabicFirst.id)).status()).toBe(303);
  const people = (await collectionsOf(orgA)).find((collection) => collection.name === 'People')!;
  const nameField = (await fieldsOf(orgA, people.id)).find((field) => field.name === 'Name')!;
  expect((await itemsOf(orgA, people.id)).map((item) => item.values[nameField.id]).sort()).toEqual(PEOPLE.map((person) => person.ar.name).sort());
  // What the source held is now the English translation, not lost and not doubled.
  const english = (await db('locales').where({ tenant_id: arabicFirst.id, code: 'en' }).first()).id;
  const rows = await db('translations').where({ tenant_id: arabicFirst.id, locale_id: english, source_type: 'cms' }).select('content_value');
  expect(rows.map((row) => row.content_value).sort()).toEqual([...now.flatMap((person) => [person.name, person.role]), ...POSTS.map((post) => post.title)].sort());

  await publish(orgA);
  const root = await published(arabicFirst, '/');
  expect(root.status).toBe(200);
  expect(root.html).toMatch(/dir="rtl"/);
  for (const person of PEOPLE) {
    expect(bodyOf(root.html)).toContain(`${person.ar.name} / ${person.ar.role}`);
    expect(bodyOf(root.html)).not.toContain(person.name);
  }
  const inEnglish = await published(arabicFirst, '/en');
  for (const person of now) {
    expect(bodyOf(inEnglish.html)).toContain(`${person.name} / ${person.role}`);
    expect(bodyOf(inEnglish.html)).not.toContain(person.ar.name);
  }
  // Each person's own page, by the slug, in both languages.
  for (const person of PEOPLE) {
    const ar = await published(arabicFirst, `/${person.slug}`);
    expect(ar.status, person.slug).toBe(200);
    expect(bodyOf(ar.html)).toContain(person.ar.name);
    const en = await published(arabicFirst, `/en/${person.slug}`);
    expect(en.status, `en ${person.slug}`).toBe(200);
    expect(bodyOf(en.html)).toContain(person.name);
  }
});

test('a template whose pointer cannot be followed refuses the copy by name and leaves no site', async () => {
  const before = (await listSites(orgA)).length;
  const sitesBefore = Number((await db('platform_sites').count({ n: '*' }).first())!.n);
  const bad = await createSite(templates, { name: 'Broken template', slug: `tc-bad-${RUN}`, languages: ['en'], default_language: 'en', is_template: true });
  toDelete.push({ api: () => templates, site: bad });
  expect((await openSite(templates, bad.id)).status()).toBe(303);
  const gone = await createCollection(templates, 'Gone', [{ name: 'Name', key: 'name', type: 'text' }]);
  const home = (await draftPages(templates)).find((page) => page.is_index)!;

  // 1. A Collection element at an id that is no collection of the template at all.
  const stranger = '99999999-9999-4999-8999-999999999999';
  await saveLayers(templates, home.id, [{ id: 'list', name: 'div', classes: '', variables: { collection: { id: stranger } }, children: [] }]);
  const strange = await orgA.post('/ycode/api/platform/sites', { data: { name: 'From broken', slug: `tc-bad-copy-${RUN}`, languages: ['en'], default_language: 'en', template_id: bad.id } });
  expect(strange.status()).toBe(500);
  const strangeBody = (await strange.json()).error as string;
  expect(strangeBody).toContain('page_layers');
  expect(strangeBody).toContain(stranger);
  expect(strangeBody).toContain('variables.collection.id');

  // 2. A Collection element at a collection the template deleted.
  await saveLayers(templates, home.id, [{ id: 'list', name: 'div', classes: '', variables: { collection: { id: gone.collection.id } }, children: [] }]);
  expect((await templates.delete(`/ycode/api/collections/${gone.collection.id}`)).status()).toBe(200);
  const deleted = await orgA.post('/ycode/api/platform/sites', { data: { name: 'From broken', slug: `tc-bad-copy-${RUN}`, languages: ['en'], default_language: 'en', template_id: bad.id } });
  expect(deleted.status()).toBe(500);
  const deletedBody = (await deleted.json()).error as string;
  expect(deletedBody).toContain(gone.collection.id);
  expect(deletedBody).toContain('did not copy');

  // Nothing was made: no site, no row of one (the transaction rolled back), and the other sites are as they were.
  expect((await listSites(orgA)).length).toBe(before);
  expect(Number((await db('platform_sites').count({ n: '*' }).first())!.n)).toBe(sitesBefore + 1); // the broken template itself
  expect(await db('platform_sites').where({ slug: `tc-bad-copy-${RUN}` })).toHaveLength(0);

  // The copy is not refused when the pointer is not there: the same template with the element removed.
  await saveLayers(templates, home.id, [{ id: 'plain', name: 'div', classes: '', children: [] }]);
  const fine = await createSite(orgA, { name: 'From fixed', slug: `tc-bad-copy-${RUN}`, languages: ['en'], default_language: 'en', template_id: bad.id });
  toDelete.push({ api: () => orgA, site: fine });
  expect(fine.id).toBeTruthy();
});
