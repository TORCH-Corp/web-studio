import type { Knex } from 'knex';

/**
 * TORCH c0 port: one deployment, many organizations.
 *
 * - `platform_organizations`: the organizations this Web Studio serves and the
 *   host names their published sites answer on.
 * - `tenant_id` (the Business OS organization id) on every ycode table, with
 *   an index; the data client adds it to every query and insert.
 * - Natural-key unique indexes rebuilt per organization (two organizations can
 *   both have a `homepage` slug, an `ar` locale, a `site_name` setting).
 * - `set_tenant_context()` + a BEFORE INSERT trigger, the hook ycode's direct
 *   knex writes already call, so those rows get their organization too.
 */

const TENANT_TABLES = [
  'ai_chats', 'api_keys', 'app_settings', 'asset_folders', 'assets', 'collection_fields', 'collection_imports',
  'collection_item_values', 'collection_items', 'collections', 'color_variables', 'components', 'fonts',
  'form_submissions', 'global_variables', 'layer_styles', 'locales', 'mcp_oauth_clients', 'mcp_oauth_codes',
  'mcp_tokens', 'page_folders', 'page_layers', 'pages', 'settings', 'translations', 'versions',
  'webhook_deliveries', 'webhooks',
];

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('platform_organizations', (table) => {
    table.uuid('id').primary();
    table.string('name').notNullable();
    table.specificType('hosts', 'text[]').notNullable().defaultTo('{}');
    table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
  });

  for (const table of TENANT_TABLES) {
    const has = await knex.schema.hasColumn(table, 'tenant_id');
    if (!has) {
      await knex.schema.alterTable(table, (t) => { t.uuid('tenant_id').nullable(); });
    }
    await knex.raw(`CREATE INDEX IF NOT EXISTS idx_${table}_tenant_id ON ?? (tenant_id)`, [table]);
  }

  // Natural keys become per-organization.
  await knex.raw('ALTER TABLE settings DROP CONSTRAINT IF EXISTS settings_key_unique');
  await knex.raw('DROP INDEX IF EXISTS settings_key_unique');
  await knex.raw('CREATE UNIQUE INDEX settings_tenant_key_unique ON settings (tenant_id, key)');

  await knex.raw('ALTER TABLE locales DROP CONSTRAINT IF EXISTS locales_code_is_published_unique');
  await knex.raw('DROP INDEX IF EXISTS locales_code_is_published_unique');
  await knex.raw('CREATE UNIQUE INDEX locales_tenant_code_is_published_unique ON locales (tenant_id, code, is_published)');

  await knex.raw('ALTER TABLE app_settings DROP CONSTRAINT IF EXISTS app_settings_app_id_key_unique');
  await knex.raw('DROP INDEX IF EXISTS app_settings_app_id_key_unique');
  await knex.raw('CREATE UNIQUE INDEX app_settings_tenant_app_id_key_unique ON app_settings (tenant_id, app_id, key)');

  await knex.raw('DROP INDEX IF EXISTS pages_slug_is_published_folder_unique');
  await knex.raw(`CREATE UNIQUE INDEX pages_tenant_slug_is_published_folder_unique
    ON pages (tenant_id, slug, is_published, COALESCE(page_folder_id, '00000000-0000-0000-0000-000000000000'::uuid), COALESCE(error_page, 0))
    WHERE deleted_at IS NULL AND is_dynamic = false`);

  // The original migrations seeded one project's starting content with no organization.
  // On the platform every organization is provisioned with its own, so those rows go.
  await knex('page_layers').whereNull('tenant_id').delete();
  await knex('pages').whereNull('tenant_id').delete();
  await knex('settings').whereNull('tenant_id').delete();
  await knex('locales').whereNull('tenant_id').delete();

  // Transaction-scoped organization for direct writes (ycode calls `set_tenant_context` before them).
  await knex.raw(`
    CREATE OR REPLACE FUNCTION set_tenant_context(p_tenant_id uuid) RETURNS void LANGUAGE sql AS $$
      SELECT set_config('app.tenant_id', p_tenant_id::text, true);
    $$;
  `);
  await knex.raw(`
    CREATE OR REPLACE FUNCTION fill_tenant_id() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.tenant_id IS NULL THEN
        NEW.tenant_id := NULLIF(current_setting('app.tenant_id', true), '')::uuid;
      END IF;
      RETURN NEW;
    END;
    $$;
  `);
  for (const table of TENANT_TABLES) {
    await knex.raw(`DROP TRIGGER IF EXISTS trg_fill_tenant_id ON ??`, [table]);
    await knex.raw(`CREATE TRIGGER trg_fill_tenant_id BEFORE INSERT ON ?? FOR EACH ROW EXECUTE FUNCTION fill_tenant_id()`, [table]);
  }
}

export async function down(knex: Knex): Promise<void> {
  for (const table of TENANT_TABLES) {
    await knex.raw(`DROP TRIGGER IF EXISTS trg_fill_tenant_id ON ??`, [table]);
  }
  await knex.raw('DROP FUNCTION IF EXISTS fill_tenant_id()');
  await knex.raw('DROP FUNCTION IF EXISTS set_tenant_context(uuid)');
  await knex.raw('DROP INDEX IF EXISTS pages_tenant_slug_is_published_folder_unique');
  await knex.raw('DROP INDEX IF EXISTS app_settings_tenant_app_id_key_unique');
  await knex.raw('DROP INDEX IF EXISTS locales_tenant_code_is_published_unique');
  await knex.raw('DROP INDEX IF EXISTS settings_tenant_key_unique');
  await knex.schema.dropTableIfExists('platform_organizations');
}
