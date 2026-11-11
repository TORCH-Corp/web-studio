/**
 * A site's collections, for the Tauri app's Collections screen (part 3, session W6;
 * PRD V1.0 "Collections", second line).
 *
 * The builder lists collections for the site its `ws_site` cookie names
 * (`/ycode/api/collections`, `getAllCollections`); the app has no such cookie, and
 * taking one means opening the site, which takes its editor lock. So the app reads
 * the list here, by site id. A site's content is under its own site id
 * (`tenant_id`), as `lib/platform/templates.ts` reads it: one statement, the draft
 * rows (`is_published = false`), nothing deleted.
 *
 * Creating and editing a collection is done in the builder; the app only lists them
 * and opens the builder on one (`builder_path`).
 */

import { getKnexClient } from '@/lib/knex-client';
import type { Site } from '@/lib/platform/site';

/** A collection as the app's list shows it. No person: the fork records none (plan decision 20a). */
export interface CollectionRow {
  id: string;
  name: string;
  /** The collection's items that are not deleted. */
  item_count: number;
  /** ISO date: the latest `updated_at` of the collection and of its items, a deleted item's included (deleting is a change). */
  last_change: string;
  /** The builder's own route for the collection, on the site the app opened. */
  builder_path: string;
}

/** What the statement returns for one collection. */
export interface CollectionRecord {
  id: string;
  name: string;
  created_at: Date | string | null;
  updated_at: Date | string | null;
  item_count: string | number;
  items_changed_at: Date | string | null;
}

/** `/ycode/collections/{id}`: the builder's route for one collection (`app/(builder)/ycode/collections/[id]`). */
export function builderPathOfCollection(id: string): string {
  return `/ycode/collections/${id}`;
}

function timeOf(value: Date | string | null): number | null {
  if (value === null) return null;
  const time = (value instanceof Date ? value : new Date(value)).getTime();
  return Number.isNaN(time) ? null : time;
}

/**
 * The row for one record. The collection's own `updated_at` moves when it is renamed or its sorting changes and
 * not when an item is edited, so the last change is the later of that and the items' latest. A collection row with
 * no `updated_at` (the column is nullable) falls back to when it was made.
 */
export function collectionRow(record: CollectionRecord): CollectionRow {
  const times = [timeOf(record.updated_at) ?? timeOf(record.created_at), timeOf(record.items_changed_at)].filter((time): time is number => time !== null);
  if (times.length === 0) throw new Error(`Collection ${record.id} has no date to report as its last change`);
  return {
    id: record.id,
    name: record.name,
    item_count: Number(record.item_count),
    last_change: new Date(Math.max(...times)).toISOString(),
    builder_path: builderPathOfCollection(record.id),
  };
}

/**
 * The site's draft collections that are not deleted, in the builder's own order (its `order`, then newest first).
 * The caller has checked that the site is the session's organization's.
 */
export async function listSiteCollections(site: Site): Promise<CollectionRow[]> {
  const knex = await getKnexClient();
  const result = await knex.raw(
    `SELECT c.id, c.name, c.created_at, c.updated_at,
            COUNT(i.id) FILTER (WHERE i.deleted_at IS NULL) AS item_count,
            MAX(i.updated_at) AS items_changed_at
       FROM collections c
       LEFT JOIN collection_items i
         ON i.collection_id = c.id AND i.is_published = c.is_published AND i.tenant_id = c.tenant_id
      WHERE c.tenant_id = ? AND c.is_published = false AND c.deleted_at IS NULL
      GROUP BY c.id, c.is_published
      ORDER BY c."order" ASC, c.created_at DESC, c.id ASC`,
    [site.id],
  );
  return (result as { rows: CollectionRecord[] }).rows.map(collectionRow);
}
