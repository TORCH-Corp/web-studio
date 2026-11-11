/**
 * Changing a site's default language (OPEN_QUESTIONS 24, found by Task B on 3 Nov 2026).
 *
 * ycode keeps the default language's text in the source (page layers, component
 * layers, page slugs and SEO, folder slugs) and every other language in
 * translations; the default language's address loads no translations. So when
 * the default changes from X to Y, the source has to change with it: every
 * completed Y translation goes into the source, and what the source held becomes
 * an X translation (unless X is leaving the site). Without this a site made from
 * an Arabic-first template with English as its default showed Arabic on its
 * English address, and so did a site whose default was changed in Site settings.
 *
 * `planSourceSwap` works on plain rows and touches nothing; the template copy
 * (`template-copy.ts`) applies the plan to the rows it is about to insert, and
 * `swapSiteSourceLanguage` applies it to a site's draft rows in one transaction.
 * A translation moves only when it was really applied: a key ycode's injector does
 * not handle (a component instance override, for one) keeps its row, and the
 * source keeps its text, which is what that language showed before.
 *
 * The text of collection items follows the same rule (OPEN_QUESTIONS 24c): an item's
 * values are the default language's text and its other languages are `cms`
 * translations. The rule is `swapCmsSource` (`template-collections.ts`), which the
 * template copy runs on the rows it is about to insert; `planCmsSwap` runs that same
 * function on a copy of a site's draft rows and reports what it changed, and
 * `swapSiteSourceLanguage` writes it in the same transaction as the pages'.
 */

import { randomUUID } from 'crypto';
import type { Knex } from 'knex';
import { generateComponentContentHash, generatePageLayersHash, generatePageMetadataHash } from '@/lib/hash-utils';
import { getKnexClient } from '@/lib/knex-client';
import { extractComponentTranslatableItems, extractFolderTranslatableItems, extractPageTranslatableItems, injectTranslatedText } from '@/lib/localisation-utils';
import { getTranslatableKey } from '@/lib/locale-runtime';
import { rehashItems, swapCmsSource, type CollectionTableRows } from '@/lib/platform/template-collections';
import type { Component, Layer, Page, Translation } from '@/types';

type Row = Record<string, unknown>;

/** The draft rows a swap reads; extra columns are carried through untouched. */
export interface SourceRows {
  pages: Row[];
  pageLayers: Row[];
  components: Row[];
  folders: Row[];
  translations: Row[];
}

/** A translation row for the old default language, holding what the source held. */
export interface MovedOutRow {
  source_type: string;
  source_id: string;
  content_key: string;
  content_type: string;
  content_value: string;
}

export interface SourceSwapPlan {
  /** page id → new slug and settings, for the pages whose metadata changed */
  pages: Map<string, { slug: string; settings: Record<string, unknown> }>;
  /** page id → new layers */
  pageLayers: Map<string, Layer[]>;
  /** component id → new layers */
  components: Map<string, Layer[]>;
  /** folder id → new slug */
  folders: Map<string, string>;
  /** ids of the new default's translation rows now held by the source */
  moved: string[];
  /** rows for the old default language (empty when it leaves the site) */
  movedOut: MovedOutRow[];
}

const usable = (row: Row) => !row.deleted_at && row.is_completed === true
  && typeof row.content_value === 'string' && row.content_value.trim() !== '';

const sameValue = (a: unknown, b: unknown) => String(a ?? '').trim() === String(b ?? '').trim();

/**
 * What the source and the translations become when `toLocaleId` replaces the
 * current default. `keepFrom` is false when the old default leaves the site.
 */
export function planSourceSwap(rows: SourceRows, toLocaleId: string, keepFrom: boolean): SourceSwapPlan {
  const plan: SourceSwapPlan = { pages: new Map(), pageLayers: new Map(), components: new Map(), folders: new Map(), moved: [], movedOut: [] };

  const incoming: Record<string, Translation> = {};
  for (const row of rows.translations) {
    if (row.locale_id === toLocaleId && usable(row)) incoming[getTranslatableKey(row as unknown as Translation)] = row as unknown as Translation;
  }
  if (Object.keys(incoming).length === 0) return plan;

  const components = rows.components as unknown as Component[];

  /** Moves one key: the incoming row leaves, the source's value becomes the old default's row. */
  const move = (key: string, item: { source_type: string; source_id: string; content_key: string; content_type: string; content_value: unknown }) => {
    plan.moved.push(incoming[key].id);
    if (keepFrom) {
      plan.movedOut.push({
        source_type: item.source_type,
        source_id: item.source_id,
        content_key: item.content_key,
        content_type: item.content_type,
        content_value: String(item.content_value),
      });
    }
  };

  /**
   * Layer items: moved when the injector changed the source to the incoming value,
   * or when both languages already held the same value. Anything else stays put.
   */
  const settleLayers = (
    before: ReturnType<typeof extractPageTranslatableItems>,
    after: ReturnType<typeof extractPageTranslatableItems>,
  ) => {
    const afterByKey = new Map(after.map((item) => [item.key, item]));
    for (const item of before) {
      if (!item.content_key.startsWith('layer:')) continue;
      const translation = incoming[item.key];
      if (!translation) continue;
      const changed = !sameValue(afterByKey.get(item.key)?.content_value, item.content_value);
      if (changed || sameValue(translation.content_value, item.content_value)) move(item.key, item);
    }
  };

  for (const page of rows.pages) {
    const id = page.id as string;
    const layersRow = rows.pageLayers.find((candidate) => candidate.page_id === id);
    const layers = (layersRow?.layers ?? []) as Layer[];
    const before = extractPageTranslatableItems(page as unknown as Page, layers, undefined, components);

    // Slug, SEO and custom code live on the page row.
    const settings = structuredClone((page.settings ?? {}) as Record<string, any>);
    let slug = page.slug as string;
    let metadataChanged = false;
    for (const item of before) {
      const translation = incoming[item.key];
      if (!translation || item.content_key.startsWith('layer:')) continue;
      const value = translation.content_value;
      if (item.content_key === 'slug') slug = value;
      else if (item.content_key === 'seo:title' || item.content_key === 'seo:description' || item.content_key === 'seo:image') {
        settings.seo = { ...(settings.seo ?? {}), [item.content_key.slice(4)]: value };
      } else if (item.content_key === 'custom_code:head' || item.content_key === 'custom_code:body') {
        settings.custom_code = { ...(settings.custom_code ?? {}), [item.content_key.slice(12)]: value };
      } else {
        continue;
      }
      metadataChanged = true;
      move(item.key, item);
    }
    if (metadataChanged) plan.pages.set(id, { slug, settings });

    if (layers.length === 0) continue;
    const swapped = injectTranslatedText(layers, id, incoming);
    const after = extractPageTranslatableItems({ ...page, slug, settings } as unknown as Page, swapped, undefined, components);
    const movedBefore = plan.moved.length;
    settleLayers(before, after);
    if (plan.moved.length > movedBefore) plan.pageLayers.set(id, swapped);
  }

  for (const component of rows.components) {
    const id = component.id as string;
    const layers = (component.layers ?? []) as Layer[];
    if (layers.length === 0) continue;
    const ref = { id, name: component.name as string };
    const before = extractComponentTranslatableItems(ref, layers);
    const swapped = injectTranslatedText(layers, '', incoming, { defaultMasterComponentId: id });
    const movedBefore = plan.moved.length;
    settleLayers(before, extractComponentTranslatableItems(ref, swapped));
    if (plan.moved.length > movedBefore) plan.components.set(id, swapped);
  }

  for (const folder of rows.folders) {
    const items = extractFolderTranslatableItems(folder as { id: string; slug: string; name: string });
    for (const item of items) {
      const translation = incoming[item.key];
      if (!translation || item.content_key !== 'slug') continue;
      plan.folders.set(folder.id as string, translation.content_value);
      move(item.key, item);
    }
  }

  return plan;
}

/** Applies a plan to rows in memory (the template copy, before its rows are inserted). */
export function applySourceSwap(rows: SourceRows, plan: SourceSwapPlan, fromLocaleId: string): void {
  for (const page of rows.pages) {
    const change = plan.pages.get(page.id as string);
    if (change) Object.assign(page, change);
  }
  for (const layersRow of rows.pageLayers) {
    const layers = plan.pageLayers.get(layersRow.page_id as string);
    if (layers) layersRow.layers = layers;
  }
  for (const component of rows.components) {
    const layers = plan.components.get(component.id as string);
    if (layers) component.layers = layers;
  }
  for (const folder of rows.folders) {
    const slug = plan.folders.get(folder.id as string);
    if (slug !== undefined) folder.slug = slug;
  }

  const moved = new Set(plan.moved);
  const kept = rows.translations.filter((row) => !moved.has(row.id as string));
  const template = rows.translations[0] ?? {};
  const outKey = (sourceType: unknown, sourceId: unknown, contentKey: unknown) => `${sourceType}:${sourceId}:${contentKey}`;
  const existing = new Map(kept.filter((row) => row.locale_id === fromLocaleId).map((row) => [outKey(row.source_type, row.source_id, row.content_key), row]));
  for (const out of plan.movedOut) {
    const row = existing.get(outKey(out.source_type, out.source_id, out.content_key));
    if (row) Object.assign(row, { content_type: out.content_type, content_value: out.content_value, is_completed: true, deleted_at: null });
    else kept.push({ ...template, ...out, id: randomUUID(), locale_id: fromLocaleId, is_completed: true, is_published: false, deleted_at: null });
  }
  rows.translations.splice(0, rows.translations.length, ...kept);
}

/** The draft rows of a site's collections the items' swap reads (the cms translations of the two languages included). */
export type CmsRows = Pick<CollectionTableRows, 'collection_fields' | 'collection_items' | 'collection_item_values' | 'translations'>;

/** What `swapCmsSource` changed in a site's draft rows. */
export interface CmsSwapPlan {
  /** value row id → the text it now holds */
  values: Map<string, string>;
  /** item id → its content hash after the swap, for the items whose values changed: ycode keeps it equal to the hash of the item's values */
  itemHashes: Map<string, string>;
  /** ids of the new default's translation rows now held by the item values */
  moved: string[];
  /** translation rows for the old default language to insert, or (same id) to bring up to date; empty when it leaves the site */
  written: Row[];
}

/**
 * What the items' values and cms translations become when `toLocaleId` replaces `fromLocaleId` as the default.
 * It is `swapCmsSource`, the rule the template copy applies, run on a copy of the rows: the rows it is given
 * are not touched. `keepFrom` is false when the old default leaves the site.
 */
export function planCmsSwap(rows: CmsRows, toLocaleId: string, fromLocaleId: string, keepFrom: boolean): CmsSwapPlan {
  const work = structuredClone(rows);
  const valueBefore = new Map(work.collection_item_values.map((row) => [row.id as string, row.value]));
  const translationBefore = new Map(work.translations.map((row) => [row.id as string, JSON.stringify(row)]));

  swapCmsSource(work, toLocaleId, fromLocaleId, keepFrom);

  const plan: CmsSwapPlan = { values: new Map(), itemHashes: new Map(), moved: [], written: [] };
  const changedItems = new Set<unknown>();
  for (const row of work.collection_item_values) {
    if (row.value === valueBefore.get(row.id as string)) continue;
    plan.values.set(row.id as string, row.value as string);
    changedItems.add(row.item_id);
  }
  const items = work.collection_items.filter((item) => changedItems.has(item.id));
  rehashItems(items, work.collection_item_values);
  for (const item of items) plan.itemHashes.set(item.id as string, item.content_hash as string);

  const after = new Set(work.translations.map((row) => row.id as string));
  plan.moved = [...translationBefore.keys()].filter((id) => !after.has(id));
  plan.written = work.translations.filter((row) => translationBefore.get(row.id as string) !== JSON.stringify(row));
  return plan;
}

/**
 * Makes `to` a site's default language: swaps the draft source to it and moves the
 * default flag, in one transaction, so the text and the flag never disagree (Site
 * settings). `keepFrom` is false when the old default is being removed from the site.
 */
export async function swapSiteSourceLanguage(siteId: string, from: { id: string }, to: { id: string }, keepFrom: boolean): Promise<SourceSwapPlan> {
  const knex = await getKnexClient();
  return knex.transaction(async (trx) => {
    const draft = (table: string) => trx(table).where({ tenant_id: siteId, is_published: false }).whereNull('deleted_at');
    const rows: SourceRows = {
      pages: await draft('pages'),
      pageLayers: await draft('page_layers'),
      components: await draft('components'),
      folders: await draft('page_folders'),
      translations: await trx('translations').where({ tenant_id: siteId, is_published: false }).whereIn('locale_id', [from.id, to.id]),
    };
    const plan = planSourceSwap(rows, to.id, keepFrom);
    await writePlan(trx, siteId, rows, plan, from.id);

    // The items' text, in the same transaction: a site with no item translated into the new default has nothing to read.
    const cmsTranslations = rows.translations.filter((row) => row.source_type === 'cms');
    if (cmsTranslations.some((row) => row.locale_id === to.id && !row.deleted_at)) {
      const cms: CmsRows = {
        collection_fields: await draft('collection_fields'),
        collection_items: await draft('collection_items'),
        collection_item_values: await draft('collection_item_values'),
        translations: cmsTranslations,
      };
      await writeCmsPlan(trx, siteId, planCmsSwap(cms, to.id, from.id, keepFrom), from.id);
    }
    // The flag, as ycode's setDefaultLocale moves it: drafts only; publish carries it.
    const now = new Date().toISOString();
    await trx('locales').where({ tenant_id: siteId, is_published: false, is_default: true }).update({ is_default: false, updated_at: now });
    const moved = await trx('locales').where({ tenant_id: siteId, is_published: false, id: to.id }).whereNull('deleted_at').update({ is_default: true, updated_at: now });
    if (moved !== 1) throw new Error(`The language ${to.id} is not one of the site's languages`);
    return plan;
  });
}

async function writePlan(trx: Knex.Transaction, siteId: string, rows: SourceRows, plan: SourceSwapPlan, fromLocaleId: string): Promise<void> {
  const now = new Date().toISOString();
  const scope = (table: string, id: string) => trx(table).where({ tenant_id: siteId, id, is_published: false });

  for (const [id, change] of plan.pages) {
    const page = rows.pages.find((row) => row.id === id)!;
    const content_hash = generatePageMetadataHash({ ...(page as any), ...change });
    await scope('pages', id).update({ slug: change.slug, settings: JSON.stringify(change.settings), content_hash, updated_at: now });
  }
  for (const [pageId, layers] of plan.pageLayers) {
    const row = rows.pageLayers.find((candidate) => candidate.page_id === pageId)!;
    const content_hash = generatePageLayersHash({ layers, generated_css: (row.generated_css as string | null) ?? null });
    await scope('page_layers', row.id as string).update({ layers: JSON.stringify(layers), content_hash, updated_at: now });
  }
  for (const [id, layers] of plan.components) {
    const component = rows.components.find((row) => row.id === id)!;
    const content_hash = generateComponentContentHash({ ...(component as any), layers });
    await scope('components', id).update({ layers: JSON.stringify(layers), content_hash, updated_at: now });
  }
  for (const [id, slug] of plan.folders) await scope('page_folders', id).update({ slug, updated_at: now });

  if (plan.moved.length) {
    await trx('translations').where({ tenant_id: siteId, is_published: false }).whereIn('id', plan.moved).update({ deleted_at: now, updated_at: now });
  }
  for (const out of plan.movedOut) {
    await trx('translations')
      .insert({ id: randomUUID(), tenant_id: siteId, locale_id: fromLocaleId, ...out, is_completed: true, is_published: false, deleted_at: null, created_at: now, updated_at: now })
      .onConflict(['tenant_id', 'locale_id', 'source_type', 'source_id', 'content_key', 'is_published'])
      .merge({ content_type: out.content_type, content_value: out.content_value, is_completed: true, deleted_at: null, updated_at: now });
  }
}

/** Pieces of a list, so no statement carries more bound values than Postgres allows. */
function* chunks<T>(list: T[], size: number): Generator<T[]> {
  for (let start = 0; start < list.length; start += size) yield list.slice(start, start + size);
}

/**
 * Writes what `planCmsSwap` planned, on drafts only (the published rows follow at the next publish): the items' new
 * values and their hashes (ycode recomputes an item's hash whenever one of its values changes, and publish compares it
 * with the published item's), the new default's translation rows that the values now hold are deleted, and the old
 * default's text is stored as its translation, a row that is already there (a deleted one included) being brought back
 * rather than doubled.
 */
async function writeCmsPlan(trx: Knex.Transaction, siteId: string, plan: CmsSwapPlan, fromLocaleId: string): Promise<void> {
  const now = new Date().toISOString();

  for (const batch of chunks([...plan.values], 500)) {
    await trx.raw(
      `UPDATE collection_item_values AS v SET value = d.value, updated_at = ?
         FROM jsonb_to_recordset(?::jsonb) AS d(id uuid, value text)
        WHERE v.id = d.id AND v.tenant_id = ? AND v.is_published = false`,
      [now, JSON.stringify(batch.map(([id, value]) => ({ id, value }))), siteId],
    );
  }
  for (const batch of chunks([...plan.itemHashes], 500)) {
    await trx.raw(
      `UPDATE collection_items AS i SET content_hash = d.content_hash, updated_at = ?
         FROM jsonb_to_recordset(?::jsonb) AS d(id uuid, content_hash text)
        WHERE i.id = d.id AND i.tenant_id = ? AND i.is_published = false`,
      [now, JSON.stringify(batch.map(([id, content_hash]) => ({ id, content_hash }))), siteId],
    );
  }
  for (const batch of chunks(plan.moved, 500)) {
    await trx('translations').where({ tenant_id: siteId, is_published: false }).whereIn('id', batch).update({ deleted_at: now, updated_at: now });
  }
  for (const batch of chunks(plan.written, 500)) {
    await trx('translations')
      .insert(batch.map((row) => ({
        id: row.id,
        tenant_id: siteId,
        locale_id: fromLocaleId,
        source_type: row.source_type,
        source_id: row.source_id,
        content_key: row.content_key,
        content_type: row.content_type,
        content_value: row.content_value,
        is_completed: true,
        is_published: false,
        deleted_at: null,
        created_at: now,
        updated_at: now,
      })))
      .onConflict(['tenant_id', 'locale_id', 'source_type', 'source_id', 'content_key', 'is_published'])
      .merge(['content_type', 'content_value', 'is_completed', 'deleted_at', 'updated_at']);
  }
}
