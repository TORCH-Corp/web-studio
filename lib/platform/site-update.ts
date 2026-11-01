/**
 * Changing a site's own row in `platform_sites` (part 1, sessions 5 and 7).
 *
 * The slug is the site's default address, so a slug change moves it; the
 * settings API (session 7) calls these functions. All forget the lookups, so the
 * old name stops resolving and the new one starts at once in this process.
 */

import type { Knex } from 'knex';
import { getKnexClient } from '@/lib/knex-client';
import { forgetSiteLookups, resolveSiteId, type Site } from '@/lib/platform/site';
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

    // A template has no address (session 4): renaming it moves nothing.
    const hosts = site.is_template ? site.hosts : hostsAfterSlugChange(site.hosts, site.slug, newSlug);
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
 * the sites domain other than the site's own is refused. A template keeps no
 * hosts at all (session 4): the settings API refuses a custom host on one
 * before it gets here.
 */
export async function setCustomHosts(siteId: string, customHosts: string[]): Promise<Site | null> {
  const knex = await getKnexClient();
  const updated = await knex.transaction(async (trx) => {
    const site = (await trx('platform_sites').where({ id: siteId }).whereNull('deleted_at').forUpdate().first()) as Site | undefined;
    if (!site) return null;
    if (site.is_template) return site;

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

/** The language the shell shows first; it follows the default locale of the site's locales. */
export async function setSiteDefaultLocale(siteId: string, code: string): Promise<void> {
  const knex = await getKnexClient();
  await knex('platform_sites').where({ id: siteId }).whereNull('deleted_at').update({ default_locale: code });
  forgetSiteLookups();
}

/**
 * The site's name is kept in two places: `platform_sites.name` (All sites) and
 * ycode's `site_name` setting (the builder's General settings, the OAuth
 * consent page). `setSetting` and `setSettings` call this after storing
 * `site_name`, so an edit from either side reaches the other. A value that is
 * not a name (the setting was cleared) changes nothing.
 */
export async function mirrorSiteName(value: unknown): Promise<void> {
  if (typeof value !== 'string' || value.trim() === '') return;
  const siteId = await resolveSiteId();
  if (!siteId) return;
  const knex = await getKnexClient();
  await knex('platform_sites').where({ id: siteId }).whereNull('deleted_at').whereNot('name', value.trim()).update({ name: value.trim() });
  forgetSiteLookups();
}
