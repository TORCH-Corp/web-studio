import type { Knex } from 'knex';

/**
 * Part 3, session W8: the three conversion events and the daily totals (PRD V1.0
 * "Visit counting" and "Conversions report").
 *
 * platform_visits (made by session W7) now holds four kinds: 'view', and the
 * events 'add_to_cart' (sent by the store's add to cart), 'order' (written when
 * a checkout creates its Sales order) and 'form' (written when a submission
 * that is not spam is stored). An event has no page. Each carries the visitor
 * key the visitor's page view has that day (lib/platform/visit-events.ts).
 *
 * - The kind gets its list now that it is known: a typo cannot make a row no
 *   total reads.
 * - A visitor's add to cart is one row per day: a partial unique index on the
 *   visitor key (which is already per site and per day), so that two requests
 *   at once, or a bot's hundred, still leave one. Orders and form submissions
 *   have no such index: each is a real order or a real submission.
 *
 * platform_visit_site_days: the site's numbers for a finished day (visitors,
 * visitors who added to the cart, who ordered, who wrote, and the orders and
 * forms themselves), one row per site and day. It is also the record that a
 * day is totalled: the daily run (lib/platform/visit-totals-run.ts) totals a
 * day that has no row here, and deletes the detail older than 90 days only for
 * days that have one. Like platform_visit_days it is never deleted from, and it
 * holds numbers only.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw("ALTER TABLE platform_visits ADD CONSTRAINT platform_visits_kind_check CHECK (kind IN ('view', 'add_to_cart', 'order', 'form'))");
  await knex.raw("CREATE UNIQUE INDEX platform_visits_cart_once_index ON platform_visits (site_id, visitor_key) WHERE kind = 'add_to_cart'");

  await knex.schema.createTable('platform_visit_site_days', (table) => {
    table.uuid('site_id').notNullable().references('id').inTable('platform_sites').onDelete('CASCADE');
    table.date('day').notNullable();
    table.integer('visitors').notNullable().defaultTo(0);
    table.integer('cart_visitors').notNullable().defaultTo(0);
    table.integer('order_visitors').notNullable().defaultTo(0);
    table.integer('orders').notNullable().defaultTo(0);
    table.integer('form_visitors').notNullable().defaultTo(0);
    table.integer('forms').notNullable().defaultTo(0);
    table.primary(['site_id', 'day'], { constraintName: 'platform_visit_site_days_pkey' });
  });
  await knex.raw(
    `ALTER TABLE platform_visit_site_days ADD CONSTRAINT platform_visit_site_days_counts_check CHECK (
       visitors >= 0 AND cart_visitors >= 0 AND order_visitors >= 0 AND orders >= 0 AND form_visitors >= 0 AND forms >= 0
       AND order_visitors <= orders AND form_visitors <= forms
     )`,
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('platform_visit_site_days');
  await knex.raw('DROP INDEX IF EXISTS platform_visits_cart_once_index');
  await knex.raw('ALTER TABLE platform_visits DROP CONSTRAINT IF EXISTS platform_visits_kind_check');
}
