import type { Knex } from 'knex';

/**
 * TORCH part 1, session 4: templates are sites.
 *
 * A template is a live site with `is_template` true in the TORCH templates
 * organization (env `WS_TEMPLATES_ORG`). `template` holds what the Templates
 * list shows for it, its name and description in Arabic and English:
 * `{"name": {"ar", "en"}, "description": {"ar", "en"}}`. It is null on an
 * ordinary site. `pnpm templates:seed` creates the three templates of part 1.
 *
 * Also the per-tenant unique key of `translations`, the one natural key
 * 20261101000001 did not rebuild: the data client's upsert puts `tenant_id`
 * in the conflict target (translations are upserted by their locale, source
 * and key), and PostgreSQL needs a unique index that matches it. Creating a
 * translation failed until now; copying a template's translations needs it.
 * The constraint name is PostgreSQL's 63-character truncation of knex's.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('platform_sites', (table) => {
    table.jsonb('template').nullable();
  });
  await knex.raw('CREATE INDEX platform_sites_templates_idx ON platform_sites (organization_id) WHERE is_template AND deleted_at IS NULL');

  await knex.raw('ALTER TABLE translations DROP CONSTRAINT IF EXISTS translations_locale_id_source_type_source_id_content_key_is_pub');
  await knex.raw('DROP INDEX IF EXISTS translations_locale_id_source_type_source_id_content_key_is_pub');
  await knex.raw('CREATE UNIQUE INDEX translations_tenant_source_key_unique ON translations (tenant_id, locale_id, source_type, source_id, content_key, is_published)');
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP INDEX IF EXISTS translations_tenant_source_key_unique');
  await knex.raw('ALTER TABLE translations ADD CONSTRAINT translations_locale_id_source_type_source_id_content_key_is_pub UNIQUE (locale_id, source_type, source_id, content_key, is_published)');
  await knex.raw('DROP INDEX IF EXISTS platform_sites_templates_idx');
  await knex.schema.alterTable('platform_sites', (table) => {
    table.dropColumn('template');
  });
}
