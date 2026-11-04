import type { Knex } from 'knex';
import path from 'path';
import pg from 'pg';

/**
 * Knex configuration (c0 port): one PostgreSQL database on the TORCH platform,
 * given by DATABASE_URL, like every other Business OS service.
 *
 * The pg type parsers below make rows look the way PostgREST returned them:
 * timestamps as ISO strings, bigint counts as numbers.
 */
pg.types.setTypeParser(1184, (v: string) => new Date(v).toISOString()); // timestamptz
pg.types.setTypeParser(1114, (v: string) => new Date(v + 'Z').toISOString()); // timestamp
pg.types.setTypeParser(20, (v: string) => Number(v)); // int8
pg.types.setTypeParser(1700, (v: string) => Number(v)); // numeric

const createConfig = (): Knex.Config => ({
  client: 'pg',
  connection: () => {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is not set. Web Studio needs the platform PostgreSQL.');
    return Promise.resolve({ connectionString: url, ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false });
  },
  migrations: {
    directory: path.join(process.cwd(), 'database/migrations'),
    extension: 'ts',
    tableName: 'migrations',
  },
  pool: {
    min: 0,
    max: Number(process.env.DATABASE_POOL_MAX || 10),
    idleTimeoutMillis: 30000,
  },
});

const config: { [key: string]: Knex.Config } = {
  development: createConfig(),
  production: createConfig(),
  test: createConfig(),
};

export default config;
