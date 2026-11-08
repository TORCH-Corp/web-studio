import type { Knex } from 'knex';

/**
 * TORCH part 2, session W1: a site's store settings and its checkout records
 * (PRD V1.1 "Store settings", "Platform").
 *
 * Two platform tables keyed by site, written with direct knex like
 * platform_site_locks. Neither is a tenant table (no `tenant_id`), and the
 * template copy does not copy them (lib/platform/template-copy.ts,
 * COPIED_TABLES): a site created from a template starts with the defaults.
 *
 * platform_site_store: one row per site, created on the site's first read
 * (lib/platform/store-settings.ts). The branch and the categories are
 * Organization Setup's and Product & Services' ids; nothing else of theirs is
 * stored. A site that sells must have a branch, here as well as in the API.
 *
 * platform_storefront_orders: one row per checkout that became a Sales order
 * (session W3 writes it after Sales answers): the order's id and code, the
 * site and the time. No buyer data and no item data (PRD V1.1 "Platform").
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('platform_site_store', (table) => {
    table.uuid('site_id').primary().references('id').inTable('platform_sites').onDelete('CASCADE');
    table.boolean('selling').notNullable().defaultTo(false);
    table.string('currency', 3).notNullable().defaultTo('IQD');
    table.uuid('branch_id').nullable();
    table.specificType('category_ids', 'uuid[]').notNullable().defaultTo(knex.raw("'{}'::uuid[]"));
    table.decimal('delivery_fee', 14, 2).notNullable().defaultTo(0);
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.uuid('updated_by').nullable();
  });
  await knex.raw("ALTER TABLE platform_site_store ADD CONSTRAINT platform_site_store_currency_check CHECK (currency IN ('IQD', 'USD'))");
  await knex.raw('ALTER TABLE platform_site_store ADD CONSTRAINT platform_site_store_fee_check CHECK (delivery_fee >= 0)');
  await knex.raw('ALTER TABLE platform_site_store ADD CONSTRAINT platform_site_store_branch_required CHECK (NOT selling OR branch_id IS NOT NULL)');

  await knex.schema.createTable('platform_storefront_orders', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('site_id').notNullable().references('id').inTable('platform_sites');
    table.uuid('checkout_id').notNullable();
    table.uuid('sales_order_id').notNullable();
    table.text('sales_order_code').notNullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.unique(['site_id', 'checkout_id'], { indexName: 'platform_storefront_orders_checkout_unique' });
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('platform_storefront_orders');
  await knex.schema.dropTableIfExists('platform_site_store');
}
