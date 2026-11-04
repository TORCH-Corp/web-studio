/**
 * Recreate the e2e database from empty and run every migration.
 *
 * Reads DATABASE_URL_TEST only (never DATABASE_URL), and refuses a database
 * whose name does not contain "test", so a developer's database cannot be
 * wiped by accident. Run by the Playwright web server command before the build.
 */

import knex from 'knex';
import knexfile from '../knexfile';

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL_TEST;
  if (!url) throw new Error('DATABASE_URL_TEST is not set');

  const databaseName = new URL(url).pathname.replace(/^\//, '');
  if (!/test/i.test(databaseName)) {
    throw new Error(`Refusing to reset "${databaseName}": the e2e database name must contain "test"`);
  }

  process.env.DATABASE_URL = url;
  const db = knex(knexfile.test);
  try {
    await db.raw('DROP SCHEMA IF EXISTS public CASCADE');
    await db.raw('DROP SCHEMA IF EXISTS auth CASCADE');
    await db.raw('DROP SCHEMA IF EXISTS storage CASCADE');
    await db.raw('CREATE SCHEMA public');
    const [, migrations] = (await db.migrate.latest()) as [number, string[]];
    console.log(`e2e database "${databaseName}" recreated: ${migrations.length} migrations`);
  } finally {
    await db.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
