import type { Knex } from 'knex';

/**
 * TORCH part 1, session 6: one editor at a time per site.
 *
 * One row per site that somebody has open in the builder. It is not a tenant
 * table (no `tenant_id`): the site id is the key, and the lock service reads
 * and writes it for a site the caller names. A row whose `heartbeat_at` is
 * older than 15 minutes is free (lib/platform/site-lock.ts); rows are never
 * swept, the next editor overwrites them.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('platform_site_locks', (table) => {
    table.uuid('site_id').primary().references('id').inTable('platform_sites').onDelete('CASCADE');
    table.text('user_id').notNullable();
    table.text('user_name').notNullable();
    table.timestamp('acquired_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('heartbeat_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('platform_site_locks');
}
