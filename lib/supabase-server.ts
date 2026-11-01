/**
 * Server data client (c0 port).
 *
 * This module keeps the names ycode's repositories import (`getSupabaseAdmin`,
 * `getTenantIdFromHeaders`, `runWithTenantId`, `tenantStore`) but returns the
 * TORCH platform client instead of a Supabase client: plain PostgreSQL through
 * knex, scoped to the site of the current request.
 *
 * "Tenant" in the rest of the code base means the site (part 1, session 1:
 * an organization has one or more sites, see lib/platform/site.ts).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { createPlatformClient } from '@/lib/platform/pg-client';
import { resolveSiteId, runWithSite, siteStore } from '@/lib/platform/site';
import { getKnexClient } from '@/lib/knex-client';

export const tenantStore = siteStore;

export function runWithTenantId<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
  return runWithSite(tenantId, fn);
}

/**
 * The data client for the site of the current request (or the one passed
 * in). Typed as SupabaseClient so the repositories compile unchanged; the
 * object implements the query-builder subset they use.
 */
export async function getSupabaseAdmin(tenantId?: string): Promise<SupabaseClient | null> {
  const siteId = await resolveSiteId(tenantId);
  return createPlatformClient(siteId) as unknown as SupabaseClient;
}

/** Kept for the two callers that still read it; there is no Supabase config any more. */
export const getSupabaseConfig = async (): Promise<null> => null;

export async function testSupabaseConnection(): Promise<{ success: boolean; error?: string }> {
  try {
    const knex = await getKnexClient();
    await knex.raw('select 1');
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Database connection failed' };
  }
}

/** The site id of the current request, used by the direct knex paths to scope their reads. */
export async function getTenantIdFromHeaders(): Promise<string | null> {
  return resolveSiteId();
}

export async function executeSql(sql: string): Promise<{ success: boolean; error?: string }> {
  try {
    const knex = await getKnexClient();
    await knex.raw(sql);
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'SQL failed' };
  }
}
