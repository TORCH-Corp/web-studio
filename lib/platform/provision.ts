/**
 * Provisioning a site in Web Studio (part 1, session 1).
 *
 * A site is created for an organization with the starting content ycode's
 * migrations used to seed for a single project: a blank homepage, the three
 * error pages, the default settings and the chosen locales (ar, en or both,
 * one of them the default). Everything is inserted inside one transaction
 * with the new site as tenant context, so the `fill_tenant_id` trigger stamps
 * every row with the site id.
 *
 * Creating from a template (session 4) is the same transaction with another
 * seeder: `provisionSite(input, copyTemplate(template))` in place of
 * `seedBlankSite` (lib/platform/template-copy.ts). A seeder that fails rolls
 * the transaction back, and any file it copied into the new site's storage
 * is removed.
 */

import type { Knex } from 'knex';
import { getKnexClient } from '@/lib/knex-client';
import { DEFAULT_ERROR_PAGES } from '@/lib/page-utils';
import { generatePageLayersHash, generatePageMetadataHash } from '@/lib/hash-utils';
import { getDefaultSitemapSettings } from '@/lib/sitemap-utils';
import { getLocaleByCode } from '@/lib/localisation-utils';
import { forgetSiteLookups, type Site } from '@/lib/platform/site';
import { removeSiteStorage } from '@/lib/platform/storage';
import type { SiteInput, TemplateMeta } from '@/lib/platform/site-input';

export interface ProvisionSiteInput extends SiteInput {
  /** A fixed id (the seeded templates); generated when absent. */
  id?: string;
  organizationId: string;
  /** The Business OS user creating the site (the session's `sub`). */
  createdBy: string | null;
  /** A TORCH template (session 4): the route allows it to the templates organization only. */
  isTemplate?: boolean;
  /** The template's name and description in Arabic and English (with `isTemplate`). */
  templateMeta?: TemplateMeta;
}

/** Fills a freshly inserted site with its starting rows, inside the provisioning transaction. */
export type SiteSeeder = (trx: Knex.Transaction, site: Site, input: ProvisionSiteInput) => Promise<void>;

/** The slug or a host is already taken by a live site. */
export class SiteConflictError extends Error {
  constructor(public readonly field: 'slug' | 'hosts', message: string) {
    super(message);
    this.name = 'SiteConflictError';
  }
}

const UNIQUE_VIOLATION = '23505';

export async function provisionSite(input: ProvisionSiteInput, seed: SiteSeeder = seedBlankSite): Promise<Site> {
  const knex = await getKnexClient();

  const site = await knex.transaction(async (trx) => {
    if (input.hosts.length > 0) {
      const taken = await trx('platform_sites')
        .select('id')
        .whereNull('deleted_at')
        .whereRaw('hosts && ?::text[]', [input.hosts])
        .first();
      if (taken) throw new SiteConflictError('hosts', 'A host is already used by another site');
    }

    let row: Site;
    try {
      [row] = (await trx('platform_sites')
        .insert({
          ...(input.id ? { id: input.id } : {}),
          organization_id: input.organizationId,
          name: input.name,
          slug: input.slug,
          hosts: input.hosts,
          default_locale: input.default_language,
          is_template: input.isTemplate ?? false,
          template: input.isTemplate && input.templateMeta ? JSON.stringify(input.templateMeta) : null,
          created_by: input.createdBy,
        })
        .returning('*')) as Site[];
    } catch (error) {
      if ((error as { code?: string }).code === UNIQUE_VIOLATION) {
        throw new SiteConflictError('slug', `The slug "${input.slug}" is already used by another site`);
      }
      throw error;
    }

    await trx.raw('SELECT set_tenant_context(?::uuid)', [row.id]);
    try {
      await seed(trx, row, input);
    } catch (error) {
      try {
        await removeSiteStorage(row.id);
      } catch (cleanupError) {
        console.error(`[provisionSite] the files of the failed site ${row.id} could not be removed`, cleanupError);
      }
      throw error;
    }
    return row;
  });

  forgetSiteLookups();
  return site;
}

/** ycode's starting content for a blank project: a homepage, the error pages, settings and locales. */
export const seedBlankSite: SiteSeeder = async (trx, site, input) => {
  const homepageLayers = [{ id: 'body', name: 'body', classes: '', children: [] }];
  const [homepage] = await trx('pages').insert({
    name: 'Homepage', slug: '', depth: 0, is_index: true, is_published: false,
    content_hash: generatePageMetadataHash({ name: 'Homepage', slug: '', settings: {}, is_index: true, is_dynamic: false, error_page: null }),
  }).returning('*');
  await trx('page_layers').insert({
    page_id: homepage.id, layers: JSON.stringify(homepageLayers), is_published: false,
    content_hash: generatePageLayersHash({ layers: homepageLayers, generated_css: null }),
  });

  for (const errorPage of DEFAULT_ERROR_PAGES) {
    const pageHash = generatePageMetadataHash({ name: errorPage.name, slug: '', settings: errorPage.settings, is_index: false, is_dynamic: false, error_page: errorPage.code });
    const base = { name: errorPage.name, error_page: errorPage.code, slug: '', depth: 0, order: 0, settings: JSON.stringify(errorPage.settings), content_hash: pageHash };
    const [draft] = await trx('pages').insert({ ...base, is_published: false }).returning('id');
    await trx('pages').insert({ ...base, id: draft.id, is_published: true });
    const layersHash = generatePageLayersHash({ layers: errorPage.layers, generated_css: null });
    const [draftLayers] = await trx('page_layers').insert({ page_id: draft.id, layers: errorPage.layers, is_published: false, content_hash: layersHash }).returning('id');
    await trx('page_layers').insert({ id: draftLayers.id, page_id: draft.id, layers: errorPage.layers, is_published: true, content_hash: layersHash });
  }

  const settings: Array<{ key: string; value: unknown }> = [
    { key: 'site_name', value: site.name },
    { key: 'site_description', value: '' },
    { key: 'ycode_version', value: '0.1.0' },
    { key: 'sitemap', value: getDefaultSitemapSettings() },
    { key: 'ycode_badge', value: false },
    { key: 'timezone', value: 'Asia/Baghdad' },
  ];
  await trx('settings').insert(settings.map((s) => ({ key: s.key, value: JSON.stringify(s.value) })));

  await trx('locales').insert(input.languages.map((code) => ({
    code,
    label: getLocaleByCode(code)?.label ?? code,
    is_default: code === input.default_language,
    is_published: false,
  })));
};
