import assert from 'node:assert/strict';
import { test } from 'node:test';

import { generateCollectionItemContentHash } from '../hash-utils';
import { applySourceSwap, planCmsSwap, planSourceSwap, type SourceRows } from './default-language';

const AR = 'locale-ar';
const EN = 'locale-en';

const doc = (text: string) => ({ type: 'dynamic_rich_text', data: { content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] } } });
const textOf = (layer: any): string => layer.variables.text.data.content.content[0].content[0].text;

function rows(): SourceRows {
  return {
    pages: [
      { id: 'home', name: 'Home', slug: '', is_index: true, is_dynamic: false, error_page: null, settings: { seo: { title: 'الرئيسية', description: 'وصف' } } },
      { id: 'about', name: 'About', slug: 'man-nahnu', is_index: false, is_dynamic: false, error_page: null, settings: {} },
    ],
    pageLayers: [
      {
        id: 'layers-home',
        page_id: 'home',
        generated_css: '.x{}',
        layers: [{
          id: 'body', name: 'body', classes: '', children: [
            { id: 'title', name: 'heading', classes: '', children: [], variables: { text: doc('مرحبا') } },
            { id: 'same', name: 'text', classes: '', children: [], variables: { text: doc('0770 000 0000') } },
            { id: 'untranslated', name: 'text', classes: '', children: [], variables: { text: doc('بلا ترجمة') } },
            { id: 'draft', name: 'text', classes: '', children: [], variables: { text: doc('مسودة') } },
            { id: 'pic', name: 'image', classes: '', children: [], variables: { image: { src: { type: 'asset', data: { asset_id: 'asset-1' } }, alt: { type: 'dynamic_text', data: { content: 'صورة' } } } } },
          ],
        }],
      },
      { id: 'layers-about', page_id: 'about', generated_css: null, layers: [{ id: 'body', name: 'body', classes: '', children: [] }] },
    ],
    components: [{ id: 'cmp', name: 'Footer', layers: [{ id: 'cmp-root', name: 'div', classes: '', children: [{ id: 'cmp-text', name: 'text', classes: '', children: [], variables: { text: doc('حقوق') } }] }] }],
    folders: [],
    translations: [
      { id: 't-title', locale_id: EN, source_type: 'page', source_id: 'home', content_key: 'layer:title:text', content_type: 'text', content_value: 'Hello', is_completed: true, deleted_at: null },
      { id: 't-same', locale_id: EN, source_type: 'page', source_id: 'home', content_key: 'layer:same:text', content_type: 'text', content_value: '0770 000 0000', is_completed: true, deleted_at: null },
      { id: 't-draft', locale_id: EN, source_type: 'page', source_id: 'home', content_key: 'layer:draft:text', content_type: 'text', content_value: 'Draft', is_completed: false, deleted_at: null },
      { id: 't-alt', locale_id: EN, source_type: 'page', source_id: 'home', content_key: 'layer:pic:image_alt', content_type: 'text', content_value: 'Picture', is_completed: true, deleted_at: null },
      { id: 't-seo', locale_id: EN, source_type: 'page', source_id: 'home', content_key: 'seo:title', content_type: 'text', content_value: 'Home', is_completed: true, deleted_at: null },
      { id: 't-slug', locale_id: EN, source_type: 'page', source_id: 'about', content_key: 'slug', content_type: 'text', content_value: 'about', is_completed: true, deleted_at: null },
      { id: 't-cmp', locale_id: EN, source_type: 'component', source_id: 'cmp', content_key: 'layer:cmp-text:text', content_type: 'text', content_value: 'Rights', is_completed: true, deleted_at: null },
      { id: 't-override', locale_id: EN, source_type: 'page', source_id: 'home', content_key: 'layer:nowhere:override:text:v1', content_type: 'text', content_value: 'Orphan', is_completed: true, deleted_at: null },
      { id: 't-old-ar', locale_id: AR, source_type: 'page', source_id: 'home', content_key: 'layer:title:text', content_type: 'text', content_value: 'قديم', is_completed: false, deleted_at: '2026-11-01T00:00:00Z' },
    ],
  };
}

const children = (r: SourceRows, pageId: string) => ((r.pageLayers.find((l) => l.page_id === pageId)!.layers as any[])[0].children as any[]);

test('the new default\'s completed translations become the source, and the old source becomes its translations', () => {
  const r = rows();
  const plan = planSourceSwap(r, EN, true);
  applySourceSwap(r, plan, AR);

  const home = children(r, 'home');
  assert.equal(textOf(home.find((l) => l.id === 'title')), 'Hello');
  assert.equal(home.find((l) => l.id === 'pic').variables.image.alt.data.content, 'Picture');
  assert.equal(home.find((l) => l.id === 'pic').variables.image.src.data.asset_id, 'asset-1');
  assert.equal(textOf((r.components[0].layers as any[])[0].children[0]), 'Rights');
  assert.equal(r.pages.find((p) => p.id === 'about')!.slug, 'about');
  assert.deepEqual((r.pages.find((p) => p.id === 'home')!.settings as any).seo, { title: 'Home', description: 'وصف' });

  const arabic = Object.fromEntries(r.translations.filter((t) => t.locale_id === AR && !t.deleted_at).map((t) => [`${t.source_id}:${t.content_key}`, t.content_value]));
  assert.deepEqual(arabic, {
    'home:layer:title:text': 'مرحبا',
    'home:layer:same:text': '0770 000 0000',
    'home:layer:pic:image_alt': 'صورة',
    'home:seo:title': 'الرئيسية',
    'about:slug': 'man-nahnu',
    'cmp:layer:cmp-text:text': 'حقوق',
  });
  // The soft-deleted Arabic row of the same key is revived rather than duplicated.
  assert.equal(r.translations.filter((t) => t.locale_id === AR && t.content_key === 'layer:title:text').length, 1);
  assert.equal(r.translations.find((t) => t.id === 't-old-ar')!.is_completed, true);
});

test('what was not applied stays where it was: an incomplete translation, an untranslated text, a key the injector does not handle', () => {
  const r = rows();
  const plan = planSourceSwap(r, EN, true);
  assert.deepEqual(plan.moved.sort(), ['t-alt', 't-cmp', 't-same', 't-seo', 't-slug', 't-title']);
  applySourceSwap(r, plan, AR);

  const home = children(r, 'home');
  assert.equal(textOf(home.find((l) => l.id === 'draft')), 'مسودة');
  assert.equal(textOf(home.find((l) => l.id === 'untranslated')), 'بلا ترجمة');
  const english = r.translations.filter((t) => t.locale_id === EN).map((t) => t.id).sort();
  assert.deepEqual(english, ['t-draft', 't-override']);
});

test('when the old default leaves the site, nothing is written for it', () => {
  const r = rows();
  const plan = planSourceSwap(r, EN, false);
  assert.deepEqual(plan.movedOut, []);
  applySourceSwap(r, plan, AR);
  assert.equal(textOf(children(r, 'home').find((l) => l.id === 'title')), 'Hello');
  assert.equal(r.translations.filter((t) => t.locale_id === AR && !t.deleted_at).length, 0);
});

test('a language with no completed translations changes nothing', () => {
  const r = rows();
  r.translations = r.translations.filter((t) => t.id === 't-draft');
  const plan = planSourceSwap(r, EN, true);
  assert.equal(plan.moved.length + plan.movedOut.length + plan.pageLayers.size + plan.pages.size, 0);
});

// ---- The items' text (OPEN_QUESTIONS 24c) ----------------------------------------------------------------------------
// A site whose default is English changes it to Arabic: each item's values are English, its Arabic is in translations.

type Row = Record<string, unknown>;
const F = { name: 'field-name', role: 'field-role', photo: 'field-photo', bio: 'field-bio' };
const I = { sara: 'item-sara', omar: 'item-omar', lina: 'item-lina' };

function cmsRows() {
  return {
    collection_fields: [
      { id: F.name, collection_id: 'people', key: 'name', type: 'text' },
      { id: F.role, collection_id: 'people', key: null, type: 'text' },
      { id: F.photo, collection_id: 'people', key: null, type: 'image' },
      { id: F.bio, collection_id: 'people', key: null, type: 'rich_text' },
    ] as Row[],
    collection_items: [
      { id: I.sara, collection_id: 'people', content_hash: 'old-sara' },
      { id: I.omar, collection_id: 'people', content_hash: 'old-omar' },
      { id: I.lina, collection_id: 'people', content_hash: 'old-lina' },
    ] as Row[],
    collection_item_values: [
      { id: 'v-sara-name', item_id: I.sara, field_id: F.name, value: 'Sara Ali' },
      { id: 'v-sara-role', item_id: I.sara, field_id: F.role, value: 'Designer' },
      { id: 'v-sara-photo', item_id: I.sara, field_id: F.photo, value: 'asset-1' },
      { id: 'v-omar-name', item_id: I.omar, field_id: F.name, value: 'Omar Hassan' },
      { id: 'v-omar-role', item_id: I.omar, field_id: F.role, value: 'Engineer' },
      { id: 'v-lina-name', item_id: I.lina, field_id: F.name, value: 'Lina Noor' },
      { id: 'v-lina-role', item_id: I.lina, field_id: F.role, value: 'Writer' },
    ] as Row[],
    translations: [
      // Completed: Sara's name by its key, her role by its field id (a field the user added has no key).
      { id: 'ar-sara-name', tenant_id: 'site', locale_id: AR, source_type: 'cms', source_id: I.sara, content_key: 'field:key:name', content_type: 'text', content_value: 'سارة علي', is_completed: true, is_published: false, deleted_at: null },
      { id: 'ar-sara-role', tenant_id: 'site', locale_id: AR, source_type: 'cms', source_id: I.sara, content_key: `field:id:${F.role}`, content_type: 'text', content_value: 'مصممة', is_completed: true, is_published: false, deleted_at: null },
      // Not completed (the item's text was edited after it was written): never applied, for a page too.
      { id: 'ar-omar-name', tenant_id: 'site', locale_id: AR, source_type: 'cms', source_id: I.omar, content_key: 'field:key:name', content_type: 'text', content_value: 'عمر حسن', is_completed: false, is_published: false, deleted_at: null },
      // Lina has none. A page's translation is not this plan's.
      { id: 'ar-page', tenant_id: 'site', locale_id: AR, source_type: 'page', source_id: 'home', content_key: 'layer:title:text', content_type: 'text', content_value: 'مرحبا', is_completed: true, is_published: false, deleted_at: null },
    ] as Row[],
  };
}

const valueOf = (plan: ReturnType<typeof planCmsSwap>, rows: ReturnType<typeof cmsRows>, itemId: string, fieldId: string) => {
  const row = rows.collection_item_values.find((value) => value.item_id === itemId && value.field_id === fieldId)!;
  return plan.values.get(row.id as string) ?? row.value;
};

test('an item value with a completed translation in the new default takes it, and the old text becomes the translation in the old language', () => {
  const rows = cmsRows();
  const plan = planCmsSwap(rows, AR, EN, true);

  assert.equal(valueOf(plan, rows, I.sara, F.name), 'سارة علي');
  assert.equal(valueOf(plan, rows, I.sara, F.role), 'مصممة', 'a field the user added is found by its id');
  assert.equal(valueOf(plan, rows, I.sara, F.photo), 'asset-1', 'an image is not text');
  assert.deepEqual([...plan.moved].sort(), ['ar-sara-name', 'ar-sara-role'], 'the Arabic rows are now the source');

  const english = plan.written.filter((row) => row.locale_id === EN).map((row) => [row.source_id, row.content_key, row.content_type, row.content_value, row.is_completed, row.is_published, row.deleted_at]).sort();
  assert.deepEqual(english, [
    [I.sara, 'field:key:name', 'text', 'Sara Ali', true, false, null],
    [I.sara, `field:id:${F.role}`, 'text', 'Designer', true, false, null],
  ].sort());
  // Rows for the old language are new rows of the same tenant, not copies of the Arabic ids.
  for (const row of plan.written) {
    assert.equal(row.tenant_id, 'site');
    assert.equal(['ar-sara-name', 'ar-sara-role'].includes(row.id as string), false);
  }
});

test('the item\'s content hash follows its values, and only the items that changed are rehashed', () => {
  const rows = cmsRows();
  const plan = planCmsSwap(rows, AR, EN, true);

  assert.deepEqual([...plan.itemHashes.keys()], [I.sara]);
  assert.equal(plan.itemHashes.get(I.sara), generateCollectionItemContentHash([
    { field_id: F.name, value: 'سارة علي' },
    { field_id: F.role, value: 'مصممة' },
    { field_id: F.photo, value: 'asset-1' },
  ]));
});

test('an item value with an incomplete translation, or none, keeps its text, and nothing is lost', () => {
  const rows = cmsRows();
  const plan = planCmsSwap(rows, AR, EN, true);

  // Omar: his Arabic was not completed. His English stays the value and the unfinished Arabic stays where it was.
  assert.equal(valueOf(plan, rows, I.omar, F.name), 'Omar Hassan');
  assert.equal(valueOf(plan, rows, I.omar, F.role), 'Engineer');
  assert.equal(plan.moved.includes('ar-omar-name'), false);
  // Lina: no translation at all.
  assert.equal(valueOf(plan, rows, I.lina, F.name), 'Lina Noor');
  assert.equal(valueOf(plan, rows, I.lina, F.role), 'Writer');
  assert.equal(plan.itemHashes.has(I.omar) || plan.itemHashes.has(I.lina), false);
  // No row for the old language is written for them, and no value changes: every text of theirs is still in a value.
  assert.equal(plan.written.some((row) => row.source_id === I.omar || row.source_id === I.lina), false);
  assert.deepEqual([...plan.values.keys()].sort(), ['v-sara-name', 'v-sara-role']);
});

test('an item with some fields translated and others not: only the translated ones move', () => {
  const rows = cmsRows();
  rows.translations = rows.translations.filter((row) => row.id !== 'ar-sara-role');
  const plan = planCmsSwap(rows, AR, EN, true);

  assert.equal(valueOf(plan, rows, I.sara, F.name), 'سارة علي');
  assert.equal(valueOf(plan, rows, I.sara, F.role), 'Designer');
  assert.deepEqual(plan.written.map((row) => row.content_key), ['field:key:name']);
});

test('when the old default leaves the site no translation is written for it, and a blank translation is not applied', () => {
  const rows = cmsRows();
  rows.translations.find((row) => row.id === 'ar-sara-role')!.content_value = '   ';
  const plan = planCmsSwap(rows, AR, EN, false);

  assert.equal(valueOf(plan, rows, I.sara, F.name), 'سارة علي');
  assert.equal(valueOf(plan, rows, I.sara, F.role), 'Designer');
  assert.deepEqual(plan.moved, ['ar-sara-name']);
  assert.deepEqual(plan.written, []);
});

test('a translation row the old language already has for the field, even a deleted one, is brought back, not doubled', () => {
  const rows = cmsRows();
  rows.translations.push({ id: 'en-old', tenant_id: 'site', locale_id: EN, source_type: 'cms', source_id: I.sara, content_key: 'field:key:name', content_type: 'text', content_value: 'Sara (before)', is_completed: true, is_published: false, deleted_at: '2026-11-01T00:00:00Z' });
  const plan = planCmsSwap(rows, AR, EN, true);

  const forName = plan.written.filter((row) => row.content_key === 'field:key:name');
  assert.equal(forName.length, 1);
  assert.equal(forName[0].id, 'en-old');
  assert.equal(forName[0].content_value, 'Sara Ali');
  assert.equal(forName[0].is_completed, true);
  assert.equal(forName[0].deleted_at, null);
});

test('planning the items\' swap touches no row it was given', () => {
  const rows = cmsRows();
  const before = structuredClone(rows);
  planCmsSwap(rows, AR, EN, true);
  assert.deepEqual(rows, before);
});

test('a site with no item and a language with no translations plan nothing', () => {
  const empty = { collection_fields: [], collection_items: [], collection_item_values: [], translations: [] };
  const plan = planCmsSwap(empty, AR, EN, true);
  assert.equal(plan.values.size + plan.itemHashes.size + plan.moved.length + plan.written.length, 0);

  const rows = cmsRows();
  rows.translations = rows.translations.filter((row) => row.id === 'ar-omar-name');
  const none = planCmsSwap(rows, AR, EN, true);
  assert.equal(none.values.size + none.itemHashes.size + none.moved.length + none.written.length, 0);
});
