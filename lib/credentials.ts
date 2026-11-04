/**
 * Platform configuration (c0 port).
 *
 * ycode used this module to store Supabase credentials in `.env`. Web Studio
 * takes its database from DATABASE_URL like every other Business OS service,
 * so "configured" simply means that variable is set. The interface is kept so
 * the setup and robots/sitemap routes compile unchanged.
 *
 * SERVER-ONLY.
 */

import 'server-only';

export async function get<T = unknown>(key: string): Promise<T | null> {
  if (key === 'database_url') return (process.env.DATABASE_URL as T) ?? null;
  return null; // 'supabase_config' and friends no longer exist
}

export async function set(): Promise<void> {
  throw new Error('Web Studio is configured through environment variables (DATABASE_URL); nothing is written at runtime.');
}

export async function del(): Promise<void> {
  // Nothing to delete.
}

/** True when the platform database is configured. */
export async function exists(): Promise<boolean> {
  return !!process.env.DATABASE_URL;
}

export const credentials = { get, set, del, exists };
