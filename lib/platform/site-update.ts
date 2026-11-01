/**
 * Changing the names a site answers on (part 1, session 5).
 *
 * The slug is the site's default address, so a slug change moves it; session 7's
 * settings API calls these two functions. Both forget the host lookups, so the
 * old name stops resolving and the new one starts at once in this process.
 */

import type { Knex } from 'knex';
import { getKnexClient } from '@/lib/knex-client';
import { forgetSiteLookups, type Site } from '@/lib/platform/site';
import { defaultHostFor, hostsAfterSlugChange, isSitesDomainName } from '@/lib/platform/site-hosts';
import { SiteConflictError } from '@/lib/platform/provision';

const UNIQUE_VIOLATION = '23505';

async function hostTakenByAnother(trx: Knex.Transaction, siteId: string, hosts: string[]): Promise<boolean> {
  const taken = await trx('platform_sites')
    .select('id')
    .whereNull('deleted_at')
    .whereNot('id', siteId)
    .whereRaw('hosts && ?::text[]', [hosts])
    .first();
  return Boolean(taken);
}

/** Rename the slug; the default address follows. Null when the site does not exist. */
export async function changeSiteSlug(siteId: string, newSlug: string): Promise<Site | null> {
  const knex = await getKnexClient();
  const updated = await knex.transaction(async (trx) => {
    const site = (await trx('platform_sites').where({ id: siteId }).whereNull('deleted_at').forUpdate().first()) as Site | undefined;
    if (!site) return null;
    if (site.slug === newSlug) return site;

    const hosts = hostsAfterSlugChange(site.hosts, site.slug, newSlug);
    if (await hostTakenByAnother(trx, siteId, hosts)) {
      throw new SiteConflictError('hosts', `${defaultHostFor(newSlug)} is already used by another site`);
    }
    try {
      const [row] = (await trx('platform_sites').where({ id: siteId }).update({ slug: newSlug, hosts }).returning('*')) as Site[];
      return row;
    } catch (error) {
      if ((error as { code?: string }).code === UNIQUE_VIOLATION) {
        throw new SiteConflictError('slug', `The slug "${newSlug}" is already used by another site`);
      }
      throw error;
    }
  });
  forgetSiteLookups();
  return updated;
}

/**
 * Replace the custom hosts. The default address always stays, and a name under
 * the sites domain other than the site's own is refused.
 */
export async function setCustomHosts(siteId: string, customHosts: string[]): Promise<Site | null> {
  const knex = await getKnexClient();
  const updated = await knex.transaction(async (trx) => {
    const site = (await trx('platform_sites').where({ id: siteId }).whereNull('deleted_at').forUpdate().first()) as Site | undefined;
    if (!site) return null;

    const own = defaultHostFor(site.slug);
    const squatted = customHosts.find((host) => host !== own && isSitesDomainName(host));
    if (squatted) throw new SiteConflictError('hosts', `${squatted} is under the sites domain; only a site's own slug can use it`);

    const hosts = Array.from(new Set([own, ...customHosts]));
    if (await hostTakenByAnother(trx, siteId, hosts)) {
      throw new SiteConflictError('hosts', 'A host is already used by another site');
    }
    const [row] = (await trx('platform_sites').where({ id: siteId }).update({ hosts }).returning('*')) as Site[];
    return row;
  });
  forgetSiteLookups();
  return updated;
}
