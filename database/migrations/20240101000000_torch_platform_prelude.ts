import type { Knex } from 'knex';

/**
 * TORCH c0 port: what ycode's original migrations assume from Supabase.
 *
 * They create row-level-security policies that call `auth.uid()` and insert a
 * row into `storage.buckets`. On the platform's plain PostgreSQL neither
 * exists, so this prelude (first by file name) provides inert stand-ins:
 * an empty `auth.users`, `auth.uid()` that always returns NULL (the app connects as the table owner, so the
 * policies never apply), and `storage.buckets` / `storage.objects` are plain
 * tables nothing reads. Files live in lib/platform/storage.ts.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw('CREATE EXTENSION IF NOT EXISTS pgcrypto');
  await knex.raw('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
  await knex.raw('CREATE SCHEMA IF NOT EXISTS auth');
  await knex.raw(`
    CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;
  `);
  await knex.raw(`
    CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT 'service_role'::text $$;
  `);
  // ycode's user-role bootstrap migration updates auth.users; it stays empty here.
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS auth.users (
      id uuid PRIMARY KEY, email text, raw_app_meta_data jsonb DEFAULT '{}'::jsonb,
      raw_user_meta_data jsonb DEFAULT '{}'::jsonb, created_at timestamptz DEFAULT now()
    )
  `);
  await knex.raw('CREATE SCHEMA IF NOT EXISTS storage');
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS storage.buckets (
      id text PRIMARY KEY, name text NOT NULL UNIQUE, public boolean DEFAULT false,
      file_size_limit bigint, allowed_mime_types text[], created_at timestamptz DEFAULT now()
    )
  `);
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS storage.objects (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text REFERENCES storage.buckets(id),
      name text, created_at timestamptz DEFAULT now()
    )
  `);
  await knex.raw('ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY');
}

export async function down(): Promise<void> {
  // Left in place: later migrations depend on these objects.
}
