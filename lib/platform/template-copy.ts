/**
 * Copying a template into a new site (part 1, session 4).
 *
 * `copyTemplate(template)` is a `SiteSeeder` for `provisionSite`: inside the
 * provisioning transaction, with the new site as tenant context, it reads
 * the template's draft rows (what its editor sees in the builder) and
 * inserts them for the new site: page folders, pages, page layers,
 * components, layer styles, colour variables, global variables, fonts,
 * asset folders, assets, settings, locales and translations. Every row gets
 * a new id, and every reference inside the copied rows follows the map
 * (page_folder_id, component ids inside layers, asset ids inside layers and
 * settings, locale ids on translations, colour variable ids in CSS, the
 * template's site id inside file URLs), the way ycode's own template export
 * does it: each known id is replaced wherever it appears in the row's text.
 *
 * Not copied: the published rows (the copy is a draft until its first
 * publish; the error pages get a published twin, as blank provisioning
 * gives them), the versions history, collections and forms (part 3), API
 * keys, webhooks, integrations, AI chats, and the settings in
 * `SETTINGS_NOT_COPIED` plus the AI provider keys.
 *
 * The template's languages that were not asked for stay behind with their
 * translations; a language asked for that the template lacks becomes an
 * empty locale. The template's files are copied in storage; a file that an
 * asset or font row names and that is missing fails the creation.
 */

import { randomUUID } from 'crypto';
import type { Knex } from 'knex';
import { isAgentSecretSettingKey } from '@/lib/agent/config';
import { STORAGE_BUCKET, STORAGE_FOLDERS } from '@/lib/asset-constants';
import {
  generateAssetContentHash,
  generateComponentContentHash,
  generateFontContentHash,
  generateLayerStyleContentHash,
  generatePageLayersHash,
  generatePageMetadataHash,
} from '@/lib/hash-utils';
import { getLocaleByCode } from '@/lib/localisation-utils';
import type { SiteSeeder } from '@/lib/platform/provision';
import type { Site } from '@/lib/platform/site';
import { copySiteStorage, createStorageClient, objectExists, publicUrlFor } from '@/lib/platform/storage';

/** The tenant tables a template is copied from, parents before children. */
export const COPIED_TABLES = [
  'page_folders',
  'pages',
  'page_layers',
  'components',
  'layer_styles',
  'color_variables',
  'global_variables',
  'fonts',
  'asset_folders',
  'assets',
  'settings',
  'locales',
  'translations',
] as const;

export type CopiedTable = (typeof COPIED_TABLES)[number];

type Row = Record<string, unknown>;

/**
 * Settings that stay with the template: its publish state (the copy is a
 * draft, both are rewritten by the first publish), its name (the new site
 * has its own) and its identity on the web.
 */
export const SETTINGS_NOT_COPIED: ReadonlySet<string> = new Set([
  'published_at',
  'published_css',
  'site_name',
  'global_canonical_url',
  'google_site_verification',
  'ga_measurement_id',
]);

export function isSettingCopied(key: string): boolean {
  return !SETTINGS_NOT_COPIED.has(key) && !isAgentSecretSettingKey(key);
}

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/**
 * The value with every id in the map replaced by its new id, wherever it
 * appears: a column, a key inside JSON, a uuid inside a string (a CSS
 * variable, a file URL, a translation's source). Ids not in the map are
 * left as they are.
 */
export function remapIds<T>(value: T, map: Map<string, string>): T {
  if (typeof value === 'string') {
    return value.replace(UUID_RE, (id) => map.get(id.toLowerCase()) ?? id) as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => remapIds(item, map)) as T;
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) out[key] = remapIds(item, map);
    return out as T;
  }
  return value;
}

/** The template cannot be copied as it is (a file it names is missing). */
export class TemplateCopyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TemplateCopyError';
  }
}

interface TableColumns {
  all: Set<string>;
  json: Set<string>;
}

/** The columns of the copied tables, so the copy follows the schema upstream migrations leave. */
async function describeTables(trx: Knex.Transaction): Promise<Map<CopiedTable, TableColumns>> {
  const rows = (await trx('information_schema.columns')
    .select('table_name', 'column_name', 'data_type')
    .where('table_schema', 'public')
    .whereIn('table_name', [...COPIED_TABLES])) as Array<{ table_name: CopiedTable; column_name: string; data_type: string }>;
  const columns = new Map<CopiedTable, TableColumns>();
  for (const table of COPIED_TABLES) columns.set(table, { all: new Set(), json: new Set() });
  for (const row of rows) {
    const table = columns.get(row.table_name)!;
    table.all.add(row.column_name);
    if (row.data_type === 'json' || row.data_type === 'jsonb') table.json.add(row.column_name);
  }
  return columns;
}

/** The template's draft, live rows of every copied table. */
async function readDraftRows(trx: Knex.Transaction, templateId: string, columns: Map<CopiedTable, TableColumns>): Promise<Record<CopiedTable, Row[]>> {
  const rows = {} as Record<CopiedTable, Row[]>;
  for (const table of COPIED_TABLES) {
    const query = trx(table).where('tenant_id', templateId);
    const all = columns.get(table)!.all;
    if (all.has('is_published')) query.where('is_published', false);
    if (all.has('deleted_at')) query.whereNull('deleted_at');
    rows[table] = (await query) as Row[];
  }
  return rows;
}

/** A row ready for the new site: without the template's system columns, every id following the map. */
function prepare(row: Row, map: Map<string, string>): Row {
  const { tenant_id: _tenant, created_at: _created, updated_at: _updated, ...rest } = row;
  return remapIds(rest, map);
}

async function insertRows(trx: Knex.Transaction, table: CopiedTable, rows: Row[], json: Set<string>, siteId: string): Promise<void> {
  if (rows.length === 0) return;
  const data = rows.map((row) => {
    const out: Row = { ...row, tenant_id: siteId };
    for (const column of json) {
      if (out[column] !== undefined && out[column] !== null) out[column] = JSON.stringify(out[column]);
    }
    return out;
  });
  await trx.batchInsert(table, data, 100);
}

/** A seeder that copies this template into the site being provisioned. */
export function copyTemplate(template: Site): SiteSeeder {
  return async (trx, site, input) => {
    const columns = await describeTables(trx);
    const rows = await readDraftRows(trx, template.id, columns);

    // The languages asked for; a template language not asked for stays behind with its translations.
    const languages = input.languages as string[];
    rows.locales = rows.locales.filter((locale) => languages.includes(locale.code as string));
    const keptLocaleIds = new Set(rows.locales.map((locale) => locale.id));
    rows.translations = rows.translations.filter((translation) => keptLocaleIds.has(translation.locale_id));
    rows.settings = rows.settings.filter((setting) => isSettingCopied(setting.key as string));

    // Every copied row gets a new id; the template's site id becomes the new site's (file URLs).
    const map = new Map<string, string>([[template.id.toLowerCase(), site.id]]);
    for (const table of COPIED_TABLES) {
      for (const row of rows[table]) map.set((row.id as string).toLowerCase(), randomUUID());
    }

    // The files, before the rows that point at them.
    await copySiteStorage(template.id, site.id);
    for (const asset of rows.assets) {
      const storagePath = asset.storage_path as string | null;
      if (storagePath && !(await objectExists(site.id, STORAGE_BUCKET, storagePath))) {
        throw new TemplateCopyError(`The file of the asset "${asset.filename}" (${storagePath}) is missing from the template's storage`);
      }
    }
    for (const font of rows.fonts) {
      const storagePath = font.storage_path as string | null;
      if (storagePath && !(await objectExists(site.id, STORAGE_BUCKET, storagePath))) {
        throw new TemplateCopyError(`The file of the font "${font.family}" (${storagePath}) is missing from the template's storage`);
      }
    }

    const copied = {} as Record<CopiedTable, Row[]>;
    for (const table of COPIED_TABLES) copied[table] = rows[table].map((row) => prepare(row, map));

    // File URLs and content hashes are the new site's.
    for (const asset of copied.assets) {
      if (asset.storage_path) asset.public_url = publicUrlFor(site.id, STORAGE_BUCKET, asset.storage_path as string);
      asset.content_hash = generateAssetContentHash(asset as Parameters<typeof generateAssetContentHash>[0]);
    }
    for (const font of copied.fonts) {
      if (font.storage_path) font.url = publicUrlFor(site.id, STORAGE_BUCKET, font.storage_path as string);
      font.content_hash = generateFontContentHash(font as Parameters<typeof generateFontContentHash>[0]);
    }
    const storage = createStorageClient(site.id).from(STORAGE_BUCKET);
    for (const [index, component] of copied.components.entries()) {
      if (component.thumbnail_url) {
        // The preview is stored under the component's id: it moves to the new id, or is left for the builder to regenerate.
        const from = `${STORAGE_FOLDERS.COMPONENTS}/${rows.components[index].id}.webp`;
        const to = `${STORAGE_FOLDERS.COMPONENTS}/${component.id}.webp`;
        if (await objectExists(site.id, STORAGE_BUCKET, from)) {
          await storage.move(from, to);
          component.thumbnail_url = publicUrlFor(site.id, STORAGE_BUCKET, to);
        } else {
          component.thumbnail_url = null;
        }
      }
      component.content_hash = generateComponentContentHash(component as Parameters<typeof generateComponentContentHash>[0]);
    }
    for (const page of copied.pages) page.content_hash = generatePageMetadataHash(page as Parameters<typeof generatePageMetadataHash>[0]);
    for (const layers of copied.page_layers) layers.content_hash = generatePageLayersHash(layers as Parameters<typeof generatePageLayersHash>[0]);
    for (const style of copied.layer_styles) style.content_hash = generateLayerStyleContentHash(style as Parameters<typeof generateLayerStyleContentHash>[0]);

    // The default language is the new site's; a language the template lacks is an empty locale.
    for (const locale of copied.locales) locale.is_default = locale.code === input.default_language;
    for (const code of languages) {
      if (!copied.locales.some((locale) => locale.code === code)) {
        copied.locales.push({ id: randomUUID(), code, label: getLocaleByCode(code)?.label ?? code, is_default: code === input.default_language, is_published: false });
      }
    }

    copied.settings.push({ id: randomUUID(), key: 'site_name', value: site.name });

    // The error pages answer on the site's hosts before its first publish, as blank provisioning gives them.
    const errorPageIds = new Set(copied.pages.filter((page) => page.error_page !== null).map((page) => page.id));
    const publishedErrorPages = copied.pages.filter((page) => errorPageIds.has(page.id)).map((page) => ({ ...page, is_published: true }));
    const publishedErrorLayers = copied.page_layers.filter((layers) => errorPageIds.has(layers.page_id)).map((layers) => ({ ...layers, is_published: true }));

    for (const table of COPIED_TABLES) {
      const extra = table === 'pages' ? publishedErrorPages : table === 'page_layers' ? publishedErrorLayers : [];
      await insertRows(trx, table, [...copied[table], ...extra], columns.get(table)!.json, site.id);
    }
  };
}
