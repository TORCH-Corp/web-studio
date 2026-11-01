/**
 * Which organization is this request working for? (c0 port)
 *
 * Resolution order:
 *   1. an explicit id (a repository call that passes one, or `runWithOrganization`),
 *   2. the Business OS session cookie (the builder and its API),
 *   3. the request host, for published sites (`platform_organizations.hosts`),
 *   4. nothing — outside a request (build time), queries return no rows.
 */

import { AsyncLocalStorage } from 'async_hooks';
import { cookies, headers } from 'next/headers';
import { getKnexClient } from '@/lib/knex-client';
import { SESSION_COOKIE, verifySession, type BosSession } from '@/lib/platform/session';

export const organizationStore = new AsyncLocalStorage<string>();

export function runWithOrganization<T>(organizationId: string, fn: () => Promise<T>): Promise<T> {
  return organizationStore.run(organizationId, fn);
}

export interface Organization {
  id: string;
  name: string;
  hosts: string[];
}

const hostCache = new Map<string, { id: string | null; at: number }>();
const HOST_TTL = 30_000;

export async function organizationIdForHost(host: string | null): Promise<string | null> {
  if (!host) return null;
  const bare = host.split(':')[0].toLowerCase();
  const cached = hostCache.get(host);
  if (cached && Date.now() - cached.at < HOST_TTL) return cached.id;
  const knex = await getKnexClient();
  const row = await knex('platform_organizations')
    .select('id')
    .whereRaw('? = ANY(hosts) OR ? = ANY(hosts)', [host.toLowerCase(), bare])
    .first() as { id: string } | undefined;
  hostCache.set(host, { id: row?.id ?? null, at: Date.now() });
  return row?.id ?? null;
}

export async function getSessionFromCookies(): Promise<BosSession | null> {
  try {
    const store = await cookies();
    return verifySession(store.get(SESSION_COOKIE)?.value);
  } catch {
    return null; // no request scope (build time, background job)
  }
}

export async function resolveOrganizationId(explicit?: string | null): Promise<string | null> {
  if (explicit) return explicit;
  const fromStore = organizationStore.getStore();
  if (fromStore) return fromStore;
  const session = await getSessionFromCookies();
  if (session) return session.org;
  try {
    const h = await headers();
    return await organizationIdForHost(h.get('x-forwarded-host') || h.get('host'));
  } catch {
    return null;
  }
}

export async function listOrganizations(): Promise<Organization[]> {
  const knex = await getKnexClient();
  return knex('platform_organizations').select('id', 'name', 'hosts').orderBy('name') as Promise<Organization[]>;
}
