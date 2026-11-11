import type { Knex } from 'knex';

/**
 * Part 3, session W7: visit counting (PRD V1.0 "Visit counting").
 *
 * Two platform tables, written and read with direct knex like
 * platform_site_store. Neither is a tenant table (no `tenant_id`), and the
 * template copy does not copy them: a site created from a template starts
 * with no visits.
 *
 * platform_visits: one row per counted event of a published site. This session
 * writes the kind 'view' (lib/platform/visits.ts); session W8 adds the events
 * ('add_to_cart', 'order', 'form'), which may have no page, so the page's id
 * and path are required for a view only. The visitor key is a keyed hash that
 * changes every day (lib/platform/visit-rules.ts). The source and the device
 * type are worked out from the referrer's host and the user agent when the row
 * is written; the referrer, the user agent, the IP address and any name are
 * not stored, and there is no country (plan decision 20d).
 *
 * platform_visit_days: the daily totals per site, day, page path, source and
 * device type. Session W8 fills it; the unique key lets its run repeat without
 * counting twice.
 */
const SOURCES = ['direct', 'search', 'social', 'referral'];
const DEVICES = ['phone', 'desktop', 'tablet'];

const inList = (column: string, values: string[]) => `${column} IN (${values.map((value) => `'${value}'`).join(', ')})`;

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('platform_visits', (table) => {
    table.bigIncrements('id').primary();
    table.uuid('site_id').notNullable().references('id').inTable('platform_sites').onDelete('CASCADE');
    table.uuid('page_id').nullable();
    table.text('path').nullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.string('visitor_key', 64).notNullable();
    table.string('source', 16).notNullable();
    table.string('device', 16).notNullable();
    table.string('kind', 16).notNullable().defaultTo('view');
    // The reports and the clean-up read a site's rows by time; a visitor's rows of the day are read by key.
    table.index(['site_id', 'created_at'], 'platform_visits_site_time_index');
    table.index(['site_id', 'visitor_key', 'created_at'], 'platform_visits_site_visitor_index');
  });
  await knex.raw(`ALTER TABLE platform_visits ADD CONSTRAINT platform_visits_source_check CHECK (${inList('source', SOURCES)})`);
  await knex.raw(`ALTER TABLE platform_visits ADD CONSTRAINT platform_visits_device_check CHECK (${inList('device', DEVICES)})`);
  await knex.raw("ALTER TABLE platform_visits ADD CONSTRAINT platform_visits_view_page_check CHECK (kind <> 'view' OR (page_id IS NOT NULL AND path IS NOT NULL))");

  await knex.schema.createTable('platform_visit_days', (table) => {
    table.uuid('site_id').notNullable().references('id').inTable('platform_sites').onDelete('CASCADE');
    table.date('day').notNullable();
    table.text('path').notNullable();
    table.string('source', 16).notNullable();
    table.string('device', 16).notNullable();
    table.integer('views').notNullable().defaultTo(0);
    table.integer('visitors').notNullable().defaultTo(0);
    table.primary(['site_id', 'day', 'path', 'source', 'device'], { constraintName: 'platform_visit_days_pkey' });
  });
  await knex.raw(`ALTER TABLE platform_visit_days ADD CONSTRAINT platform_visit_days_source_check CHECK (${inList('source', SOURCES)})`);
  await knex.raw(`ALTER TABLE platform_visit_days ADD CONSTRAINT platform_visit_days_device_check CHECK (${inList('device', DEVICES)})`);
  await knex.raw('ALTER TABLE platform_visit_days ADD CONSTRAINT platform_visit_days_counts_check CHECK (views >= 0 AND visitors >= 0)');
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('platform_visit_days');
  await knex.schema.dropTableIfExists('platform_visits');
}
