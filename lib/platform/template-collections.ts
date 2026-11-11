/**
 * What copying a template's collections needs beyond `remapIds` (part 3, session W11).
 *
 * A template's collections (`collections`, `collection_fields`, `collection_items`,
 * `collection_item_values`) and the translations of its items are copied by
 * `template-copy.ts` like its pages: draft rows, every row with a new id, every place that
 * names an id following the map. This module holds the parts that are about collections only,
 * as plain functions over rows so they are tested without a database:
 *
 * - `dropOrphans`: the copy is the template's live draft, so a row whose parent is not live
 *   stays behind with it. ycode's delete routes soft-delete a collection's fields, items and
 *   values, and an item's translations, together; a cascade that fails part way (the collection
 *   delete logs the error and goes on) leaves rows whose parent is gone, and they must not
 *   reach the copy, where they would be rows without a parent or point at a deleted id.
 * - `mapCollectionUuids`: `collections.uuid` is its own identifier with a global UNIQUE
 *   constraint, so each copied collection needs a new one.
 * - `swapCmsSource`: ycode keeps the default language's text in the item's values and every
 *   other language in translations; when the new site's default is not the template's, the
 *   items follow, as `default-language.ts` does for pages (OPEN_QUESTIONS 24).
 * - `rehashItems`: an item's content hash covers its values' field ids, which are new.
 * - `checkPointers`: after the map, no copied row may point at an id of the template. A
 *   pointer that names an id the template still holds but did not copy (a deleted collection,
 *   field or item), or that sits at a place ycode keeps an id at and names no row of the new
 *   site, fails the copy with a `TemplatePointerError` that says where.
 */

import { randomUUID } from 'crypto';
import { generateCollectionItemContentHash } from '@/lib/hash-utils';
import { TemplateCopyError } from '@/lib/platform/template-copy-error';

type Row = Record<string, unknown>;

/** The rows of the four collection tables and the translations, as `readDraftRows` returns them. */
export interface CollectionTableRows {
  collections: Row[];
  collection_fields: Row[];
  collection_items: Row[];
  collection_item_values: Row[];
  translations: Row[];
}

/** What `dropOrphans` left behind, by table. */
export interface LeftBehind {
  fields: number;
  items: number;
  values: number;
  translations: number;
}

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const WHOLE_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A copied row points at something of the template that the new site does not have. */
export class TemplatePointerError extends TemplateCopyError {
  constructor(
    public readonly table: string,
    public readonly rowId: string,
    public readonly path: string,
    public readonly target: string,
    reason: string,
  ) {
    super(`The template cannot be copied: ${table} row ${rowId} points at ${target} at ${path}, ${reason}`);
    this.name = 'TemplatePointerError';
  }
}

/** Registers each collection's own `uuid` in the id map, so the unique column and anything that names it follow. */
export function mapCollectionUuids(collections: Row[], map: Map<string, string>, newId: () => string = randomUUID): void {
  for (const collection of collections) {
    if (typeof collection.uuid === 'string') map.set(collection.uuid.toLowerCase(), newId());
  }
}

/**
 * Takes out the rows whose parent is not in the copy: fields and items of a collection that is not
 * live, values of an item or a field that is not, and translations of an item or a field that is not.
 * The rows are changed in place; the counts say what stayed behind.
 */
export function dropOrphans(rows: CollectionTableRows): LeftBehind {
  const collectionIds = new Set(rows.collections.map((row) => row.id));
  const before = { fields: rows.collection_fields.length, items: rows.collection_items.length, values: rows.collection_item_values.length, translations: rows.translations.length };

  rows.collection_fields = rows.collection_fields.filter((row) => collectionIds.has(row.collection_id));
  rows.collection_items = rows.collection_items.filter((row) => collectionIds.has(row.collection_id));
  const fieldsById = new Map(rows.collection_fields.map((row) => [row.id as string, row]));
  const itemsById = new Map(rows.collection_items.map((row) => [row.id as string, row]));
  const keysByCollection = new Map<string, Set<string>>();
  for (const field of rows.collection_fields) {
    if (typeof field.key !== 'string') continue;
    const keys = keysByCollection.get(field.collection_id as string) ?? new Set<string>();
    keys.add(field.key);
    keysByCollection.set(field.collection_id as string, keys);
  }

  rows.collection_item_values = rows.collection_item_values.filter((row) => itemsById.has(row.item_id as string) && fieldsById.has(row.field_id as string));
  rows.translations = rows.translations.filter((row) => {
    if (row.source_type !== 'cms') return true;
    const item = itemsById.get(row.source_id as string);
    if (!item) return false;
    const key = String(row.content_key);
    if (key.startsWith('field:id:')) {
      const field = fieldsById.get(key.slice('field:id:'.length));
      return field !== undefined && field.collection_id === item.collection_id;
    }
    if (key.startsWith('field:key:')) return keysByCollection.get(item.collection_id as string)?.has(key.slice('field:key:'.length)) === true;
    return true;
  });

  return {
    fields: before.fields - rows.collection_fields.length,
    items: before.items - rows.collection_items.length,
    values: before.values - rows.collection_item_values.length,
    translations: before.translations - rows.translations.length,
  };
}

const usable = (row: Row) => !row.deleted_at && row.is_completed === true && typeof row.content_value === 'string' && row.content_value.trim() !== '';
const TRANSLATABLE_TYPES = new Set(['text', 'rich_text']);

/**
 * A new default language for the items: every completed translation into `toLocaleId` of a text or rich
 * text field becomes the item's value, and the value it replaces becomes a translation into
 * `fromLocaleId` (none when the old default leaves the site, `keepFrom` false). Rows are changed in place,
 * before the id map. A translation with no value to replace, an incomplete one and a blank one stay as they are.
 */
export function swapCmsSource(rows: Pick<CollectionTableRows, 'collection_fields' | 'collection_items' | 'collection_item_values' | 'translations'>, toLocaleId: string, fromLocaleId: string, keepFrom: boolean): void {
  const fieldsById = new Map(rows.collection_fields.map((row) => [row.id as string, row]));
  const fieldsByKey = new Map<string, Row>();
  for (const field of rows.collection_fields) {
    if (typeof field.key === 'string') fieldsByKey.set(`${field.collection_id}:${field.key}`, field);
  }
  const itemsById = new Map(rows.collection_items.map((row) => [row.id as string, row]));
  const valueOf = new Map(rows.collection_item_values.map((row) => [`${row.item_id}:${row.field_id}`, row]));

  const moved = new Set<string>();
  const movedOut: Row[] = [];
  for (const translation of rows.translations) {
    if (translation.source_type !== 'cms' || translation.locale_id !== toLocaleId || !usable(translation)) continue;
    const item = itemsById.get(translation.source_id as string);
    if (!item) continue;
    const key = String(translation.content_key);
    const field = key.startsWith('field:id:') ? fieldsById.get(key.slice('field:id:'.length)) : key.startsWith('field:key:') ? fieldsByKey.get(`${item.collection_id}:${key.slice('field:key:'.length)}`) : undefined;
    if (!field || field.collection_id !== item.collection_id || !TRANSLATABLE_TYPES.has(String(field.type))) continue;
    const value = valueOf.get(`${item.id}:${field.id}`);
    if (!value || typeof value.value !== 'string' || value.value.trim() === '') continue;

    const old = value.value;
    value.value = translation.content_value;
    moved.add(translation.id as string);
    if (keepFrom) {
      movedOut.push({ ...translation, id: randomUUID(), locale_id: fromLocaleId, content_type: field.type === 'rich_text' ? 'richtext' : 'text', content_value: old, is_completed: true, deleted_at: null });
    }
  }

  const kept = rows.translations.filter((row) => !moved.has(row.id as string));
  const rowKey = (row: Row) => `${row.source_type}:${row.source_id}:${row.content_key}`;
  const existing = new Map(kept.filter((row) => row.locale_id === fromLocaleId).map((row) => [rowKey(row), row]));
  for (const out of movedOut) {
    const row = existing.get(rowKey(out));
    if (row) Object.assign(row, { content_type: out.content_type, content_value: out.content_value, is_completed: true, deleted_at: null });
    else kept.push(out);
  }
  rows.translations.splice(0, rows.translations.length, ...kept);
}

/** Sets each item's content hash from its values: the hash covers the field ids, which are the new site's. */
export function rehashItems(items: Row[], values: Row[]): void {
  const byItem = new Map<string, Array<{ field_id: string; value: string | null }>>();
  for (const value of values) {
    const list = byItem.get(value.item_id as string) ?? [];
    list.push({ field_id: value.field_id as string, value: (value.value as string | null) ?? null });
    byItem.set(value.item_id as string, list);
  }
  for (const item of items) item.content_hash = generateCollectionItemContentHash(byItem.get(item.id as string) ?? []);
}

/** Keys at which ycode keeps the id of a collection, a field or an item. */
const POINTER_KEYS = new Set([
  'collection_id', 'collectionId', 'reference_collection_id', 'referenceCollectionId',
  'slug_field_id', 'field_id', 'fieldId', 'sortFieldId', 'source_field_id', 'sort_by',
  'collection_item_id', 'defaultItemId',
]);
/** Keys that hold a list of such ids. */
const POINTER_LIST_KEYS = new Set(['defaultItemIds', 'relationships']);
/** Field types whose value is the id, or a list of the ids, of items. */
const ITEM_POINTER_TYPES = new Set(['reference', 'multi_reference']);
/** Field types whose value is JSON that can hold pointers (a rich text's links and variables, a link). */
const JSON_TYPES = new Set(['rich_text', 'link']);

type Trail = Array<string | number>;

function describe(trail: Trail): string {
  return trail.reduce<string>((path, step) => (typeof step === 'number' ? `${path}[${step}]` : path === '' ? step : `${path}.${step}`), '');
}

interface Context {
  table: string;
  rowId: string;
  /** The ids the new site owns. */
  newIds: ReadonlySet<string>;
  /** The template's collections, fields, items and collection uuids that were not copied. */
  leftBehind: ReadonlySet<string>;
}

function refuse(context: Context, trail: Trail, target: string, reason: string): never {
  throw new TemplatePointerError(context.table, context.rowId, describe(trail), target, reason);
}

const LEFT_BEHIND_REASON = 'which the template has but did not copy (it is deleted or not live)';

/** A string that is, or holds, an id of the template that was not copied. */
function checkText(text: string, context: Context, trail: Trail): void {
  for (const match of text.matchAll(UUID_RE)) {
    if (context.leftBehind.has(match[0].toLowerCase())) refuse(context, trail, match[0], LEFT_BEHIND_REASON);
  }
}

/** A value at a place that holds an id: an id of the new site, or not an id at all (a keyword, an empty value). */
function checkPointer(value: unknown, context: Context, trail: Trail): void {
  if (typeof value !== 'string' || !WHOLE_UUID_RE.test(value)) return;
  const id = value.toLowerCase();
  if (context.newIds.has(id)) return;
  refuse(context, trail, value, context.leftBehind.has(id) ? LEFT_BEHIND_REASON : 'which is no collection, field or item of the template');
}

function walk(value: unknown, context: Context, trail: Trail): void {
  if (typeof value === 'string') return checkText(value, context, trail);
  if (Array.isArray(value)) return value.forEach((item, index) => walk(item, context, [...trail, index]));
  if (value === null || typeof value !== 'object') return;

  const parent = trail[trail.length - 1];
  const grand = trail[trail.length - 2];
  for (const [key, item] of Object.entries(value as Row)) {
    const here = [...trail, key];
    if (POINTER_KEYS.has(key)) checkPointer(item, context, here);
    else if (POINTER_LIST_KEYS.has(key) && Array.isArray(item)) item.forEach((entry, index) => checkPointer(entry, context, [...here, index]));
    // The Collection element's source: variables.collection.id; a collection's own sorting: sorting.field.
    else if (key === 'id' && parent === 'collection' && grand === 'variables') checkPointer(item, context, here);
    else if (key === 'field' && parent === 'sorting' && context.table === 'collections') checkPointer(item, context, here);
    walk(item, context, here);
  }
}

/** The ids inside a value of a reference field: one id, or a JSON list of ids. */
function checkItemIds(text: string, context: Context, trail: Trail): void {
  for (const match of text.matchAll(UUID_RE)) {
    const id = match[0].toLowerCase();
    if (!context.newIds.has(id)) refuse(context, trail, match[0], context.leftBehind.has(id) ? LEFT_BEHIND_REASON : 'which is no item of the template');
  }
}

/**
 * Checks the rows about to be inserted: no pointer is left at an id of the template. Needs the ids the
 * new site owns (`newIds`: the id map's values) and the template's collection, field and item ids that were
 * not copied (`leftBehind`). Throws a `TemplatePointerError` for the first one found.
 */
export function checkPointers(tables: Record<string, Row[]>, newIds: ReadonlySet<string>, leftBehind: ReadonlySet<string>): void {
  const fieldTypes = new Map((tables.collection_fields ?? []).map((field) => [String(field.id), String(field.type)]));

  for (const [table, rows] of Object.entries(tables)) {
    for (const row of rows) {
      const context: Context = { table, rowId: String(row.id ?? row.page_id ?? row.key ?? '?'), newIds, leftBehind };
      for (const [column, value] of Object.entries(row)) {
        if (table === 'collection_item_values' && column === 'value' && typeof value === 'string') {
          const type = fieldTypes.get(String(row.field_id));
          if (type !== undefined && ITEM_POINTER_TYPES.has(type)) {
            checkItemIds(value, context, [column]);
            continue;
          }
          if (type !== undefined && JSON_TYPES.has(type)) {
            let parsed: unknown;
            try {
              parsed = JSON.parse(value);
            } catch {
              parsed = value;
            }
            walk(parsed, context, [column]);
            continue;
          }
        }
        if (POINTER_KEYS.has(column)) checkPointer(value, context, [column]);
        walk(value, context, [column]);
      }
    }
  }
}
