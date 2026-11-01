/**
 * The host names a site answers on (part 1, session 5).
 *
 * A site always answers on its default address, `{slug}.{WS_SITES_DOMAIN}`
 * (sites.torchcorp.com in production), and on the custom hosts session 7
 * adds. The default address is the first entry of `platform_sites.hosts` and
 * follows the slug. Kept free of Next imports so it runs under `node --test`.
 */

/** The domain default addresses live under. A missing value is a deployment error, never guessed. */
export function sitesDomain(env: Record<string, string | undefined> = process.env): string {
  const value = env.WS_SITES_DOMAIN?.trim().toLowerCase().replace(/^\.+|\.+$/g, '');
  if (!value) throw new Error('WS_SITES_DOMAIN is not set (sites.torchcorp.com in production)');
  return value;
}

export function defaultHostFor(slug: string, domain: string = sitesDomain()): string {
  return `${slug}.${domain}`;
}

/**
 * True for a name of the sites domain: the domain itself or anything under it.
 * Only a site's own default address may use one; nobody may take the bare
 * domain. Case does not matter, as it does not in DNS.
 */
export function isSitesDomainName(host: string, domain: string = sitesDomain()): boolean {
  const name = host.trim().toLowerCase();
  return name === domain || name.endsWith(`.${domain}`);
}

/** Hosts for a new site: its default address first, then the custom hosts, no repeats. */
export function hostsForNewSite(slug: string, customHosts: string[], domain: string = sitesDomain()): string[] {
  return Array.from(new Set([defaultHostFor(slug, domain), ...customHosts]));
}

/**
 * Hosts after a slug change: the old default address becomes the new one in
 * place; every other host stays. A site that somehow lacks its old default
 * address gets the new one at the front.
 */
export function hostsAfterSlugChange(hosts: string[], oldSlug: string, newSlug: string, domain: string = sitesDomain()): string[] {
  const oldHost = defaultHostFor(oldSlug, domain);
  const newHost = defaultHostFor(newSlug, domain);
  const swapped = hosts.includes(oldHost) ? hosts.map((host) => (host === oldHost ? newHost : host)) : [newHost, ...hosts];
  return Array.from(new Set(swapped));
}
