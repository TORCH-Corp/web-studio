import assert from 'node:assert/strict';
import { test } from 'node:test';

import { generateCollectionItemContentHash } from '@/lib/hash-utils';
import { remapIds, TemplateCopyError } from './template-copy';
import {
  checkPointers,
  dropOrphans,
  mapCollectionUuids,
  rehashItems,
  swapCmsSource,
  TemplatePointerError,
  type CollectionTableRows,
} from './template-collections';

// The template's rows, and the new site's id for each (the map the copy builds).
const T = {
  site: '00000000-0000-4000-8000-000000000001',
  people: '10000000-0000-4000-8000-000000000001',
  peopleUuid: '10000000-0000-4000-8000-0000000000aa',
  posts: '10000000-0000-4000-8000-000000000002',
  postsUuid: '10000000-0000-4000-8000-0000000000bb',
  name: '20000000-0000-4000-8000-000000000001',
  slug: '20000000-0000-4000-8000-000000000002',
  role: '20000000-0000-4000-8000-000000000003',
  author: '20000000-0000-4000-8000-000000000004',
  postTitle: '20000000-0000-4000-8000-000000000005',
  count: '20000000-0000-4000-8000-000000000006',
  sara: '30000000-0000-4000-8000-000000000001',
  omar: '30000000-0000-4000-8000-000000000002',
  post: '30000000-0000-4000-8000-000000000003',
  page: '40000000-0000-4000-8000-000000000001',
  asset: '50000000-0000-4000-8000-000000000001',
  localeEn: '60000000-0000-4000-8000-000000000001',
  localeAr: '60000000-0000-4000-8000-000000000002',
  deletedCollection: '10000000-0000-4000-8000-0000000000dd',
  deletedItem: '30000000-0000-4000-8000-0000000000dd',
  deletedField: '20000000-0000-4000-8000-0000000000dd',
  stranger: '99999999-0000-4000-8000-000000000001',
};
const N = Object.fromEntries(Object.entries(T).map(([key, id], index) => [key, `ffffffff-0000-4000-8000-${String(index + 1).padStart(12, '0')}`])) as typeof T;

const idMap = new Map<string, string>(Object.entries(T).filter(([key]) => !key.startsWith('deleted') && key !== 'stranger').map(([key, id]) => [id, N[key as keyof typeof T]]));

/** What the first test reads back from the copied rows. */
interface Remapped {
  layers: Array<{ variables: { collection: { id: string; sort_by: string } }; children: Array<{ variables?: { link: { page: { collection_item_id: string } } }; settings?: { optionsSource: { collectionId: string } } }> }>;
  page: { settings: { cms: { slug_field_id: string } } };
  field: { data: { count: { fieldId: string } } };
  author: { reference_collection_id: string };
  translation: { content_key: string; source_id: string };
  collection: { uuid: string; sorting: { field: string } };
  value: { value: string };
}

function sampleRows(): CollectionTableRows {
  return {
    collections: [
      { id: T.people, uuid: T.peopleUuid, name: 'People', sorting: { field: T.name, direction: 'asc' }, order: 0 },
      { id: T.posts, uuid: T.postsUuid, name: 'Posts', sorting: null, order: 1 },
    ],
    collection_fields: [
      { id: T.name, collection_id: T.people, reference_collection_id: null, name: 'Name', key: 'name', type: 'text', data: {} },
      { id: T.slug, collection_id: T.people, reference_collection_id: null, name: 'Slug', key: 'slug', type: 'text', data: {} },
      { id: T.role, collection_id: T.people, reference_collection_id: null, name: 'Role', key: null, type: 'text', data: {} },
      { id: T.postTitle, collection_id: T.posts, reference_collection_id: null, name: 'Title', key: 'name', type: 'text', data: {} },
      { id: T.author, collection_id: T.posts, reference_collection_id: T.people, name: 'Author', key: null, type: 'reference', data: {} },
      { id: T.count, collection_id: T.people, reference_collection_id: null, name: 'Posts', key: null, type: 'count', data: { count: { collectionId: T.posts, fieldId: T.author } } },
    ],
    collection_items: [
      { id: T.sara, collection_id: T.people, manual_order: 0, content_hash: 'x' },
      { id: T.omar, collection_id: T.people, manual_order: 1, content_hash: 'x' },
      { id: T.post, collection_id: T.posts, manual_order: 0, content_hash: 'x' },
    ],
    collection_item_values: [
      { id: 'a0000000-0000-4000-8000-000000000001', item_id: T.sara, field_id: T.name, value: 'Sara Ali' },
      { id: 'a0000000-0000-4000-8000-000000000002', item_id: T.sara, field_id: T.slug, value: 'sara-ali' },
      { id: 'a0000000-0000-4000-8000-000000000003', item_id: T.sara, field_id: T.role, value: 'Designer' },
      { id: 'a0000000-0000-4000-8000-000000000004', item_id: T.omar, field_id: T.name, value: 'Omar Hassan' },
      { id: 'a0000000-0000-4000-8000-000000000005', item_id: T.post, field_id: T.postTitle, value: 'Hello' },
      { id: 'a0000000-0000-4000-8000-000000000006', item_id: T.post, field_id: T.author, value: T.sara },
    ],
    translations: [
      { id: 'b0000000-0000-4000-8000-000000000001', locale_id: T.localeAr, source_type: 'cms', source_id: T.sara, content_key: 'field:key:name', content_type: 'text', content_value: 'سارة علي', is_completed: true },
      { id: 'b0000000-0000-4000-8000-000000000002', locale_id: T.localeAr, source_type: 'cms', source_id: T.sara, content_key: 'field:key:slug', content_type: 'text', content_value: 'sara-ar', is_completed: true },
      { id: 'b0000000-0000-4000-8000-000000000003', locale_id: T.localeAr, source_type: 'cms', source_id: T.sara, content_key: `field:id:${T.role}`, content_type: 'text', content_value: 'مصممة', is_completed: true },
      { id: 'b0000000-0000-4000-8000-000000000004', locale_id: T.localeAr, source_type: 'page', source_id: T.page, content_key: 'layer:hero:text', content_type: 'text', content_value: 'مرحبا', is_completed: true },
    ],
  };
}

test('every collection, field, item and value gets a new id, and each place that pointed at one follows', () => {
  const map = new Map(idMap);
  const collections = sampleRows().collections;
  mapCollectionUuids(collections, map, () => 'eeeeeeee-0000-4000-8000-0000000000e1');
  assert.equal(map.get(T.peopleUuid), 'eeeeeeee-0000-4000-8000-0000000000e1');

  // The places the brief names: a Collection element's source, field variables, a CMS page's settings, a link to an item,
  // an option source, a reference between collections, and a translation of an item's field.
  const layers = [
    {
      id: 'list', name: 'div', classes: '',
      variables: {
        collection: {
          id: T.people, sort_by: T.name, sort_order: 'asc', source_field_id: T.author,
          filters: { groups: [{ conditions: [{ id: 'c1', source: 'collection_field', fieldId: T.author, fieldType: 'reference', referenceCollectionId: T.people, operator: 'is_one_of', value: JSON.stringify([T.sara, T.omar]) }] }] },
        },
      },
      children: [
        {
          id: 'title', name: 'heading',
          variables: { text: { type: 'dynamic_rich_text', data: { content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'dynamicVariable', attrs: { variable: { type: 'field', data: { source: 'collection', field_id: T.name, relationships: [T.author], collection_layer_id: 'list' } } } }] }] } } } },
        },
        { id: 'more', name: 'a', variables: { link: { type: 'page', page: { id: T.page, collection_item_id: T.sara } } } },
        { id: 'pick', name: 'select', settings: { optionsSource: { collectionId: T.posts, defaultItemId: T.post, defaultItemIds: [T.post], sortFieldId: T.postTitle } }, children: [] },
      ],
    },
  ];
  const page = { id: T.page, is_dynamic: true, settings: { cms: { collection_id: T.people, slug_field_id: T.slug } } };
  const translation = sampleRows().translations[2];
  const out = remapIds({ layers, page, field: sampleRows().collection_fields[5], author: sampleRows().collection_fields[4], translation, collection: collections[0], value: sampleRows().collection_item_values[5] }, map) as unknown as Remapped;
  const text = JSON.stringify(out);

  for (const [key, id] of Object.entries(T)) {
    if (key.startsWith('deleted') || key === 'stranger' || key === 'site' || key === 'localeEn' || key === 'localeAr' || key === 'asset') continue;
    assert.equal(text.includes(id), false, `${key} (${id}) is still in the copy`);
  }
  assert.equal(out.layers[0].variables.collection.id, N.people);
  assert.equal(out.layers[0].variables.collection.sort_by, N.name);
  assert.equal(out.layers[0].children[1].variables?.link.page.collection_item_id, N.sara);
  assert.equal(out.layers[0].children[2].settings?.optionsSource.collectionId, N.posts);
  assert.equal(out.page.settings.cms.slug_field_id, N.slug);
  assert.equal(out.field.data.count.fieldId, N.author);
  assert.equal(out.author.reference_collection_id, N.people);
  assert.equal(out.translation.content_key, `field:id:${N.role}`);
  assert.equal(out.translation.source_id, N.sara);
  assert.equal(out.collection.uuid, 'eeeeeeee-0000-4000-8000-0000000000e1');
  assert.equal(out.collection.sorting.field, N.name);
  assert.equal(out.value.value, N.sara, 'a reference value follows the item');
});

test('rows whose parent is not live are left behind: fields and items of a deleted collection, values of a deleted field, translations of a deleted item or field', () => {
  const rows = sampleRows();
  rows.collection_fields.push({ id: T.deletedField, collection_id: T.deletedCollection, reference_collection_id: null, name: 'Gone', key: null, type: 'text', data: {} });
  rows.collection_items.push({ id: T.deletedItem, collection_id: T.deletedCollection, manual_order: 0 });
  rows.collection_item_values.push(
    { id: 'a0000000-0000-4000-8000-0000000000f1', item_id: T.deletedItem, field_id: T.deletedField, value: 'x' },
    { id: 'a0000000-0000-4000-8000-0000000000f2', item_id: T.sara, field_id: T.deletedField, value: 'a value of a field that is gone' },
  );
  rows.translations.push(
    { id: 'b0000000-0000-4000-8000-0000000000f1', locale_id: T.localeAr, source_type: 'cms', source_id: T.deletedItem, content_key: 'field:key:name', content_type: 'text', content_value: 'x', is_completed: true },
    { id: 'b0000000-0000-4000-8000-0000000000f2', locale_id: T.localeAr, source_type: 'cms', source_id: T.sara, content_key: `field:id:${T.deletedField}`, content_type: 'text', content_value: 'y', is_completed: true },
    { id: 'b0000000-0000-4000-8000-0000000000f3', locale_id: T.localeAr, source_type: 'cms', source_id: T.sara, content_key: 'field:key:nothing', content_type: 'text', content_value: 'z', is_completed: true },
  );

  const left = dropOrphans(rows);

  assert.deepEqual(left, { fields: 1, items: 1, values: 2, translations: 3 });
  assert.equal(rows.collection_fields.length, 6);
  assert.equal(rows.collection_items.length, 3);
  assert.equal(rows.collection_item_values.length, 6);
  // The page's translation and the live items' translations stay.
  assert.deepEqual(rows.translations.map((row) => row.id), ['b0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000003', 'b0000000-0000-4000-8000-000000000004']);
});

test('a template that has no collection leaves its translations alone', () => {
  const rows: CollectionTableRows = { collections: [], collection_fields: [], collection_items: [], collection_item_values: [], translations: [{ id: 'b0000000-0000-4000-8000-000000000009', locale_id: T.localeAr, source_type: 'page', source_id: T.page, content_key: 'seo:title', content_type: 'text', content_value: 'x', is_completed: true }] };
  assert.deepEqual(dropOrphans(rows), { fields: 0, items: 0, values: 0, translations: 0 });
  assert.equal(rows.translations.length, 1);
});

test('a new default language takes the items\' text: the completed translation becomes the value and the value becomes the old default\'s translation', () => {
  const rows = sampleRows();
  rows.collection_item_values.push({ id: 'a0000000-0000-4000-8000-0000000000c1', item_id: T.omar, field_id: T.slug, value: 'omar-hassan' });

  swapCmsSource(rows, T.localeAr, T.localeEn, true);

  const valueOf = (item: string, field: string) => rows.collection_item_values.find((row) => row.item_id === item && row.field_id === field)?.value;
  assert.equal(valueOf(T.sara, T.name), 'سارة علي');
  assert.equal(valueOf(T.sara, T.slug), 'sara-ar');
  assert.equal(valueOf(T.sara, T.role), 'مصممة');
  assert.equal(valueOf(T.omar, T.name), 'Omar Hassan', 'an item with no Arabic keeps its text');

  const cms = rows.translations.filter((row) => row.source_type === 'cms');
  assert.equal(cms.some((row) => row.locale_id === T.localeAr), false, 'the Arabic rows were taken into the source');
  assert.deepEqual(
    cms.map((row) => [row.locale_id, row.source_id, row.content_key, row.content_type, row.content_value, row.is_completed]).sort(),
    [
      [T.localeEn, T.sara, 'field:key:name', 'text', 'Sara Ali', true],
      [T.localeEn, T.sara, 'field:key:slug', 'text', 'sara-ali', true],
      [T.localeEn, T.sara, `field:id:${T.role}`, 'text', 'Designer', true],
    ].sort(),
  );
  assert.equal(rows.translations.filter((row) => row.source_type === 'page').length, 1, 'a page translation is not this function\'s');
  const movedOut = cms[0];
  assert.notEqual(movedOut.id, 'b0000000-0000-4000-8000-000000000001');
});

test('a default language that leaves the site leaves no translation of the old one; a rich text moves as rich text; an incomplete or empty translation stays where it is', () => {
  const rows = sampleRows();
  rows.collection_fields.push({ id: T.deletedField, collection_id: T.people, reference_collection_id: null, name: 'Bio', key: null, type: 'rich_text', data: {} });
  const richEn = JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] }] });
  const richAr = JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'مرحبا' }] }] });
  rows.collection_item_values.push({ id: 'a0000000-0000-4000-8000-0000000000c2', item_id: T.sara, field_id: T.deletedField, value: richEn });
  rows.translations.push({ id: 'b0000000-0000-4000-8000-0000000000c2', locale_id: T.localeAr, source_type: 'cms', source_id: T.sara, content_key: `field:id:${T.deletedField}`, content_type: 'richtext', content_value: richAr, is_completed: true });
  // Not completed: the language shows the source for it today, and keeps doing so.
  rows.translations.find((row) => row.content_key === 'field:key:slug')!.is_completed = false;
  rows.translations.find((row) => row.content_key === `field:id:${T.role}`)!.content_value = '  ';

  swapCmsSource(rows, T.localeAr, T.localeEn, false);

  const valueOf = (field: string) => rows.collection_item_values.find((row) => row.item_id === T.sara && row.field_id === field)?.value;
  assert.equal(valueOf(T.deletedField), richAr);
  assert.equal(valueOf(T.name), 'سارة علي');
  assert.equal(valueOf(T.slug), 'sara-ali', 'an incomplete translation is not applied');
  assert.equal(valueOf(T.role), 'Designer', 'a blank translation is not applied');
  assert.equal(rows.translations.some((row) => row.locale_id === T.localeEn), false, 'the old default is not kept');
  assert.deepEqual(rows.translations.filter((row) => row.source_type === 'cms').map((row) => row.content_key).sort(), ['field:key:slug', `field:id:${T.role}`].sort());
});

test('an existing translation of the old default for the same field is updated, not doubled', () => {
  const rows = sampleRows();
  rows.translations.push({ id: 'b0000000-0000-4000-8000-0000000000c3', locale_id: T.localeEn, source_type: 'cms', source_id: T.sara, content_key: 'field:key:name', content_type: 'text', content_value: 'stale', is_completed: false });

  swapCmsSource(rows, T.localeAr, T.localeEn, true);

  const english = rows.translations.filter((row) => row.locale_id === T.localeEn && row.content_key === 'field:key:name');
  assert.equal(english.length, 1);
  assert.equal(english[0].id, 'b0000000-0000-4000-8000-0000000000c3');
  assert.equal(english[0].content_value, 'Sara Ali');
  assert.equal(english[0].is_completed, true);
});

/** The copy of the sample after the id map, as the copy hands it to the pointer check. */
function copied(): Record<string, Array<Record<string, unknown>>> {
  const rows = sampleRows();
  const map = new Map(idMap);
  mapCollectionUuids(rows.collections, map, () => 'eeeeeeee-0000-4000-8000-0000000000e1');
  for (const table of ['collections', 'collection_fields', 'collection_items', 'collection_item_values'] as const) {
    for (const row of rows[table]) if (!map.has(String(row.id))) map.set(String(row.id), `dddddddd-0000-4000-8000-${String(map.size).padStart(12, '0')}`);
  }
  const layers = [
    { id: 'list', name: 'div', classes: '', variables: { collection: { id: T.people, sort_by: T.name } }, children: [{ id: 'more', name: 'a', variables: { link: { type: 'page', page: { id: T.page, collection_item_id: T.sara } } } }] },
  ];
  return remapIds({
    collections: rows.collections,
    collection_fields: rows.collection_fields,
    collection_items: rows.collection_items,
    collection_item_values: rows.collection_item_values,
    translations: rows.translations,
    page_layers: [{ id: 'c0000000-0000-4000-8000-000000000001', page_id: T.page, layers }],
    pages: [{ id: T.page, settings: { cms: { collection_id: T.people, slug_field_id: T.slug } } }],
    components: [],
    settings: [],
  }, map);
}
/** Runs the pointer check on the sample copy after `mutate`; the error it throws, or null. */
function run(mutate: (rows: Record<string, Array<Record<string, unknown>>>) => void = () => {}): TemplatePointerError | null {
  const rows = copied();
  mutate(rows);
  const newIds = new Set<string>();
  for (const table of Object.values(rows)) for (const row of table) newIds.add(String(row.id));
  for (const id of Object.values(N)) newIds.add(id);
  const leftBehind = new Set([T.deletedCollection, T.deletedItem, T.deletedField]);
  try {
    checkPointers(rows, newIds, leftBehind);
  } catch (error) {
    assert.ok(error instanceof TemplatePointerError, `expected a TemplatePointerError, got ${error}`);
    return error;
  }
  return null;
}

/** The error the check throws after `mutate`; the test fails when the copy is let through. */
function check(mutate: (rows: Record<string, Array<Record<string, unknown>>>) => void): TemplatePointerError {
  const error = run(mutate);
  assert.ok(error, 'the copy should have been refused');
  return error;
}

test('a copy whose pointers all follow passes the check', () => {
  assert.equal(run(), null);
});

const layersOf = (rows: Record<string, Array<Record<string, unknown>>>) => rows.page_layers[0].layers as Array<{ variables: { collection: { id: string; sort_by?: string } }; children: Array<{ variables: { link: { page: { collection_item_id: string } } } }> }>;

test('a Collection element that points at a collection the template deleted fails the copy, naming the row and the place', () => {
  const error = check((rows) => { layersOf(rows)[0].variables.collection.id = T.deletedCollection; });
  assert.equal(error.name, 'TemplatePointerError');
  assert.ok(error instanceof TemplateCopyError);
  assert.equal(error.table, 'page_layers');
  assert.equal(error.target, T.deletedCollection);
  assert.match(error.path, /layers\[0\]\.variables\.collection\.id$/);
  assert.match(error.message, new RegExp(T.deletedCollection));
  assert.match(error.message, /page_layers/);
});

test('a pointer at an id that exists nowhere in the template still fails: a Collection source, a link to an item, a CMS page, a reference field', () => {
  assert.match(check((rows) => { layersOf(rows)[0].variables.collection.id = T.stranger; }).path, /variables\.collection\.id$/);
  assert.match(check((rows) => { layersOf(rows)[0].variables.collection.sort_by = T.stranger; }).path, /sort_by$/);
  assert.match(check((rows) => { layersOf(rows)[0].children[0].variables.link.page.collection_item_id = T.stranger; }).path, /collection_item_id$/);
  const page = check((rows) => { ((rows.pages[0].settings as { cms: { collection_id: string } }).cms).collection_id = T.stranger; });
  assert.equal(page.table, 'pages');
  assert.match(page.path, /settings\.cms\.collection_id$/);
  const field = check((rows) => { rows.collection_fields.find((row) => row.type === 'reference')!.reference_collection_id = T.stranger; });
  assert.equal(field.table, 'collection_fields');
  assert.match(field.path, /reference_collection_id$/);
});

test('an option source, a filter and a field variable are pointers too', () => {
  const select = check((rows) => { layersOf(rows)[0].children.push({ id: 'pick', settings: { optionsSource: { collectionId: N.posts, defaultItemIds: [N.post, T.stranger] } } } as never); });
  assert.match(select.path, /optionsSource\.defaultItemIds\[1\]$/);
  const filter = check((rows) => { (layersOf(rows)[0].variables.collection as Record<string, unknown>).filters = { groups: [{ conditions: [{ fieldId: T.stranger, operator: 'is' }] }] }; });
  assert.match(filter.path, /conditions\[0\]\.fieldId$/);
  const variable = check((rows) => { layersOf(rows)[0].children.push({ id: 'x', variables: { text: { type: 'field', data: { field_id: N.name, relationships: [T.stranger] } } } } as never); });
  assert.match(variable.path, /relationships\[0\]$/);
});

test('a reference value that points at an item the template deleted fails, naming the row; a link or rich text value is read as JSON', () => {
  const reference = check((rows) => { rows.collection_item_values.find((row) => row.field_id === N.author)!.value = T.deletedItem; });
  assert.equal(reference.table, 'collection_item_values');
  assert.equal(reference.target, T.deletedItem);

  const multiple = check((rows) => {
    rows.collection_fields.find((row) => row.type === 'reference')!.type = 'multi_reference';
    rows.collection_item_values.find((row) => row.field_id === N.author)!.value = JSON.stringify([N.sara, T.stranger]);
  });
  assert.equal(multiple.target, T.stranger);

  const rich = check((rows) => {
    rows.collection_fields.find((row) => row.key === 'slug')!.type = 'rich_text';
    rows.collection_item_values.find((row) => row.field_id === N.slug)!.value = JSON.stringify({ type: 'doc', content: [{ type: 'text', marks: [{ type: 'richTextLink', attrs: { page: { id: N.page, collection_item_id: T.stranger } } }] }] });
  });
  assert.equal(rich.target, T.stranger);
});

test('an id the template left behind anywhere in a copied row fails the copy, even outside a known pointer', () => {
  const error = check((rows) => { rows.translations[3].content_value = `see ${T.deletedItem}`; });
  assert.equal(error.table, 'translations');
  assert.equal(error.target, T.deletedItem);
});

test('keywords and empty values are not pointers', () => {
  assert.equal(run((rows) => {
    Object.assign(layersOf(rows)[0].variables.collection, { sort_by: 'manual', source_field_id: '' });
    layersOf(rows)[0].children[0].variables.link.page.collection_item_id = 'current-collection';
    (rows.pages[0].settings as { cms: { slug_field_id: string } }).cms.slug_field_id = '';
  }), null);
});

test('an item\'s content hash is that of its new values, whatever the order of the rows', () => {
  const items = [{ id: 'i1', content_hash: 'stale' }, { id: 'i2', content_hash: 'stale' }, { id: 'i3', content_hash: 'stale' }];
  const values = [
    { item_id: 'i1', field_id: 'f2', value: 'B' },
    { item_id: 'i2', field_id: 'f1', value: 'X' },
    { item_id: 'i1', field_id: 'f1', value: 'A' },
    { item_id: 'i2', field_id: 'f2', value: null },
  ];

  rehashItems(items, values);

  assert.equal(items[0].content_hash, generateCollectionItemContentHash([{ field_id: 'f1', value: 'A' }, { field_id: 'f2', value: 'B' }]));
  assert.equal(items[1].content_hash, generateCollectionItemContentHash([{ field_id: 'f1', value: 'X' }, { field_id: 'f2', value: null }]));
  assert.equal(items[2].content_hash, generateCollectionItemContentHash([]), 'an item with no value has the hash of none');
  assert.notEqual(items[0].content_hash, items[1].content_hash);
});
