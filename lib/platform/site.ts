/**
 * Which site is this request working for? (part 1, session 1)
 *
 * The site is the tenant: every row ycode stores carries the site id in
 * `tenant_id`, and an organization has one or more sites (PRD V1.0 "Sites").
 *
 * Resolution order:
 *   1. an explicit id (a repository call that passes one),
 *   2. AsyncLocalStorage (work started with `runWithSite`),
 *   3. the `ws_site` cookie, for the builder and its API. The cookie names a
 *      site and the organization it was checked against; the session names
 *      the user's organization. A cookie with no session, or for another
 *      organization, or for a site that no longer exists, gives no site (the
 *      proxy has already answered 404 for the first two; this is the check
 *      against the database),
 *   4. the request host against `platform_sites.hosts`, for published sites,
 *   5. nothing: outside a request (build time), queries return no rows.
 *
 * `tenantStore`, `runWithTenantId` and `getTenantIdFromHeaders` are the names
 * ycode's code imports through lib/supabase-server.ts; they are aliases.
 */

import { AsyncLocalStorage } from 'async_hooks';
import { cookies, headers } from 'next/headers';
import { getKnexClient } from '@/lib/knex-client';
import { SESSION_COOKIE, SITE_COOKIE, verifySession, verifySiteCookie, type BosSession, type SiteCookie } from '@/lib/platform/session';

export const siteStore = new AsyncLocalStorage<string>();

export function runWithSite<T>(siteId: string, fn: () => Promise<T>): Promise<T> {
  return siteStore.run(siteId, fn);
}

/** A row of `platform_sites`. */
export interface Site {
  id: string;
  organization_id: string;
  name: string;
  slug: string;
  hosts: string[];
  default_locale: string;
  is_template: boolean;
  created_by: string | null;
  created_at: string;
  deleted_at: string | null;
}

/** A site as the All sites list shows it. */
export interface SiteSummary extends Site {
  status: 'draft' | 'published';
  last_published_at: string | null;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Host and id lookups are repeated many times per request (every repository
 * call resolves the site), so they are remembered for a short while. Creating
 * or deleting a site forgets them. The maps live on globalThis because Next
 * bundles every route on its own: a module-level map in the DELETE handler's
 * bundle is not the one the published page's bundle reads.
 */
const LOOKUP_TTL_MS = 30_000;

interface SiteLookups {
  hosts: Map<string, { id: string | null; at: number }>;
  sites: Map<string, { site: Site | null; at: number }>;
}

const globalForSites = globalThis as unknown as { __webStudioSiteLookups?: SiteLookups };

function lookups(): SiteLookups {
  globalForSites.__webStudioSiteLookups ??= { hosts: new Map(), sites: new Map() };
  return globalForSites.__webStudioSiteLookups;
}

export function forgetSiteLookups(): void {
  lookups().hosts.clear();
  lookups().sites.clear();
}

/** The first host of a `host` or `x-forwarded-host` header value, without its port, lower case. */
export function normaliseHost(value: string): string {
  const first = value.split(',')[0].trim().toLowerCase();
  const match = first.match(/^(\[[^\]]*\]|[^:]+)/);
  return match ? match[1] : '';
}

export async function siteIdForHost(headerValue: string | null): Promise<string | null> {
  if (!headerValue) return null;
  const host = normaliseHost(headerValue);
  if (!host) return null;
  const cached = lookups().hosts.get(host);
  if (cached && Date.now() - cached.at < LOOKUP_TTL_MS) return cached.id;
  const knex = await getKnexClient();
  const row = await knex('platform_sites')
    .select('id')
    .whereRaw('hosts @> ARRAY[?]::text[]', [host])
    .whereNull('deleted_at')
    .first() as { id: string } | undefined;
  lookups().hosts.set(host, { id: row?.id ?? null, at: Date.now() });
  return row?.id ?? null;
}

/** A live site by id; null when it does not exist, is deleted, or the id is not a uuid. */
export async function getSite(id: string): Promise<Site | null> {
  if (!UUID_PATTERN.test(id)) return null;
  const cached = lookups().sites.get(id);
  if (cached && Date.now() - cached.at < LOOKUP_TTL_MS) return cached.site;
  const knex = await getKnexClient();
  const site = (await knex('platform_sites').where({ id }).whereNull('deleted_at').first()) as Site | undefined;
  lookups().sites.set(id, { site: site ?? null, at: Date.now() });
  return site ?? null;
}

/** The site, if it is a live site of this organization. */
export async function getSiteForOrganization(id: string, organizationId: string): Promise<Site | null> {
  const site = await getSite(id);
  return site && site.organization_id === organizationId ? site : null;
}

/** An organization's live sites, oldest first, with their publish state. */
export async function listSites(organizationId: string): Promise<SiteSummary[]> {
  const knex = await getKnexClient();
  const rows = (await knex('platform_sites as s')
    .leftJoin('settings as p', function joinPublishedAt() {
      this.on('p.tenant_id', '=', 's.id').andOn('p.key', '=', knex.raw('?', ['published_at']));
    })
    .select('s.*', knex.raw("p.value #>> '{}' as last_published_at"))
    .where('s.organization_id', organizationId)
    .whereNull('s.deleted_at')
    .orderBy('s.created_at', 'asc')) as Array<Site & { last_published_at: string | null }>;
  return rows.map((row) => ({ ...row, status: row.last_published_at ? 'published' : 'draft' }));
}

/** Soft-delete a site: it leaves every list and its hosts stop resolving; its rows stay. */
export async function softDeleteSite(id: string): Promise<void> {
  const knex = await getKnexClient();
  await knex('platform_sites').where({ id }).whereNull('deleted_at').update({ deleted_at: knex.fn.now() });
  forgetSiteLookups();
}

export async function getSessionFromCookies(): Promise<BosSession | null> {
  try {
    const store = await cookies();
    return verifySession(store.get(SESSION_COOKIE)?.value);
  } catch {
    return null; // no request scope (build time, background job)
  }
}

export async function getSiteCookie(): Promise<SiteCookie | null> {
  try {
    const store = await cookies();
    return verifySiteCookie(store.get(SITE_COOKIE)?.value);
  } catch {
    return null;
  }
}

export async function resolveSiteId(explicit?: string | null): Promise<string | null> {
  if (explicit) return explicit;
  const fromStore = siteStore.getStore();
  if (fromStore) return fromStore;

  const siteCookie = await getSiteCookie();
  if (siteCookie) {
    const session = await getSessionFromCookies();
    if (!session || session.org !== siteCookie.org) return null;
    const site = await getSiteForOrganization(siteCookie.site, session.org);
    return site?.id ?? null;
  }

  try {
    const h = await headers();
    return await siteIdForHost(h.get('x-forwarded-host') || h.get('host'));
  } catch {
    return null;
  }
}

// The names ycode's code base uses for the tenant (through lib/supabase-server.ts).
export const tenantStore = siteStore;
export const runWithTenantId = runWithSite;
export function getTenantIdFromHeaders(): Promise<string | null> {
  return resolveSiteId();
}
