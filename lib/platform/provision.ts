/**
 * Provisioning an organization in Web Studio (c0 port).
 *
 * Business OS calls this when Web Studio is enabled for an organization: the
 * organization gets its row, its host names, and the same starting content
 * ycode's migrations used to seed for a single project — a blank homepage,
 * the three error pages, the default settings and the `en` locale. Everything
 * is inserted inside one transaction with the organization as tenant context,
 * so the `fill_tenant_id` trigger stamps every row.
 */

import { getKnexClient } from '@/lib/knex-client';
import { DEFAULT_ERROR_PAGES } from '@/lib/page-utils';
import { generatePageLayersHash, generatePageMetadataHash } from '@/lib/hash-utils';
import { getDefaultSitemapSettings } from '@/lib/sitemap-utils';

export interface ProvisionInput {
  id: string;
  name: string;
  hosts: string[];
  siteName?: string;
}

export async function provisionOrganization(input: ProvisionInput): Promise<{ created: boolean }> {
  const knex = await getKnexClient();
  const existing = await knex('platform_organizations').where('id', input.id).first();
  if (existing) {
    await knex('platform_organizations').where('id', input.id).update({ name: input.name, hosts: input.hosts });
    return { created: false };
  }

  await knex.transaction(async (trx) => {
    await trx('platform_organizations').insert({ id: input.id, name: input.name, hosts: input.hosts });
    await trx.raw('SELECT set_tenant_context(?::uuid)', [input.id]);

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
      { key: 'site_name', value: input.siteName || input.name },
      { key: 'site_description', value: '' },
      { key: 'ycode_version', value: '0.1.0' },
      { key: 'sitemap', value: getDefaultSitemapSettings() },
      { key: 'ycode_badge', value: false },
      { key: 'timezone', value: 'Asia/Baghdad' },
    ];
    await trx('settings').insert(settings.map((s) => ({ key: s.key, value: JSON.stringify(s.value) })));

    await trx('locales').insert({ code: 'en', label: 'English', is_default: true, is_published: false });
  });

  return { created: true };
}
