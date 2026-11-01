/**
 * Server data client (c0 port).
 *
 * This module keeps the names ycode's repositories import (`getSupabaseAdmin`,
 * `getTenantIdFromHeaders`, `runWithTenantId`, `tenantStore`) but returns the
 * TORCH platform client instead of a Supabase client: plain PostgreSQL through
 * knex, scoped to the organization of the current request.
 *
 * "Tenant" in the rest of the code base means the Business OS organization.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { createPlatformClient } from '@/lib/platform/pg-client';
import { organizationStore, resolveOrganizationId, runWithOrganization } from '@/lib/platform/organization';
import { getKnexClient } from '@/lib/knex-client';

export const tenantStore = organizationStore;

export function runWithTenantId<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
  return runWithOrganization(tenantId, fn);
}

/**
 * The data client for the organization of the current request (or the one
 * passed in). Typed as SupabaseClient so the repositories compile unchanged;
 * the object implements the query-builder subset they use.
 */
export async function getSupabaseAdmin(tenantId?: string): Promise<SupabaseClient | null> {
  const organizationId = await resolveOrganizationId(tenantId);
  return createPlatformClient(organizationId) as unknown as SupabaseClient;
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

/** The organization id of the current request, used by the direct knex paths to scope their reads. */
export async function getTenantIdFromHeaders(): Promise<string | null> {
  return resolveOrganizationId();
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
