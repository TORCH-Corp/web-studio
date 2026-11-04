import type { Knex } from 'knex';

/**
 * TORCH part 1, session 1: the tenant is the site.
 *
 * `platform_sites` replaces `platform_organizations`. An organization has one
 * or more sites, each with the host names its published pages answer on, and
 * `tenant_id` on every ycode table now holds the site id: the column, its
 * index and the `fill_tenant_id` trigger from 20261101000001 stay as they are.
 * The prototype data was disposable, so nothing is migrated: the database is
 * recreated from empty.
 *
 * - The slug becomes the site's default address in session 5
 *   (`{slug}.sites.torchcorp.com`), so it is unique across all organizations
 *   among live sites; a deleted site frees its slug.
 * - `hosts` is looked up with `hosts @> ARRAY[host]` (and `&&` for the conflict check),
 *   the array operators the GIN index serves.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('platform_organizations');

  await knex.schema.createTable('platform_sites', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('organization_id').notNullable();
    table.string('name', 255).notNullable();
    table.string('slug', 63).notNullable();
    table.specificType('hosts', 'text[]').notNullable().defaultTo('{}');
    table.string('default_locale', 10).notNullable().defaultTo('en');
    table.boolean('is_template').notNullable().defaultTo(false);
    table.uuid('created_by').nullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('deleted_at', { useTz: true }).nullable();
  });

  await knex.raw('CREATE UNIQUE INDEX platform_sites_slug_live_unique ON platform_sites (slug) WHERE deleted_at IS NULL');
  await knex.raw('CREATE INDEX platform_sites_organization_id_idx ON platform_sites (organization_id)');
  await knex.raw('CREATE INDEX platform_sites_hosts_gin ON platform_sites USING GIN (hosts)');
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('platform_sites');

  await knex.schema.createTable('platform_organizations', (table) => {
    table.uuid('id').primary();
    table.string('name').notNullable();
    table.specificType('hosts', 'text[]').notNullable().defaultTo('{}');
    table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
  });
}
