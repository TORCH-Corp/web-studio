import type { Knex } from 'knex';

/**
 * TORCH part 1, session 8: files in Document Center.
 *
 * With PLATFORM_STORAGE=document-center a file is a Document Center document,
 * and Document Center names it by its own uuid. This table is the index from
 * the builder's (site, bucket, key) to that document, with what the public
 * route needs to serve it without asking Document Center first. ycode's own
 * `assets` rows are untouched: they keep `storage_path` and a `public_url`
 * that points at Web Studio's /platform-storage route.
 *
 * Re-uploading in Document Center creates a new document, never a new
 * version, so a row's document never changes content: the document id is a
 * safe cache key.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('platform_storage_objects', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('site_id').notNullable();
    table.uuid('organization_id').notNullable();
    table.string('bucket', 255).notNullable();
    table.text('key').notNullable();
    table.uuid('document_id').notNullable();
    table.string('content_type', 255).notNullable();
    table.string('cache_control', 255).notNullable();
    table.bigInteger('size').notNullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  await knex.raw('CREATE UNIQUE INDEX platform_storage_objects_path_unique ON platform_storage_objects (site_id, bucket, key)');
  await knex.raw('CREATE INDEX platform_storage_objects_document_idx ON platform_storage_objects (document_id)');
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('platform_storage_objects');
}
