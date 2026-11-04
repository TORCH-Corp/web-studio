/**
 * A site's settings, read and changed as one document (part 1, session 7).
 *
 * The Tauri app's Site settings screen shows name, languages, domain and SEO
 * defaults; the builder stores them in different places. This file is the only
 * one that knows where:
 *
 *   name       platform_sites.name and the `site_name` setting (kept equal)
 *   languages  the draft `locales` rows, as ycode's localization screen makes
 *              them; removing one soft-deletes it and its draft translations,
 *              and the next publish takes it off the published site
 *   domain     platform_sites.hosts: the default address first, then the custom
 *              host (session 5 makes the site answer on them)
 *   seo        the `seo_default_*` settings the published page's head reads
 *   slug       platform_sites.slug, with the default address following
 *
 * `applySiteSettings` checks everything that can be refused before it writes
 * anything. The writes after that are separate statements (the builder's
 * repositories do not share a transaction), ordered so that what can still
 * fail on a conflict, the slug and the host, goes first.
 */

import { getSiteForOrganization, runWithSite, type Site } from '@/lib/platform/site';
import { getSupabaseAdmin } from '@/lib/supabase-server';
import { getLocaleByCode as catalogLocale } from '@/lib/localisation-utils';
import { getAllLocales, createLocale, deleteLocale, setDefaultLocale } from '@/lib/repositories/localeRepository';
import { getAssetById } from '@/lib/repositories/assetRepository';
import { getSettingByKey, getSettingsByKeys, setSettings } from '@/lib/repositories/settingsRepository';
import { clearAllCache } from '@/lib/services/cacheService';
import { getAssetProxyUrl } from '@/lib/asset-utils';
import { DomainCheckUnavailableError, domainCheckMode, isVerifiedDomain, listVerifiedDomains } from '@/lib/platform/domain-check';
import { defaultHostFor, isSitesDomainName } from '@/lib/platform/site-hosts';
import { planLanguages, type SiteSettingsPatch } from '@/lib/platform/site-settings-input';
import { SEO_DEFAULT_KEYS, storedText } from '@/lib/platform/site-seo';
import { changeSiteSlug, setCustomHosts, setSiteDefaultLocale } from '@/lib/platform/site-update';
import { swapSiteSourceLanguage } from '@/lib/platform/default-language';

export interface SiteSettings {
  id: string;
  name: string;
  slug: string;
  status: 'draft' | 'published';
  last_published_at: string | null;
  languages: Array<{ code: string; label: string; is_default: boolean }>;
  default_language: string | null;
  domain: {
    /** The address the site always has, `{slug}.sites.torchcorp.com`; read-only. */
    default_host: string;
    /** The customer's own host, if one is set. It answers after the next publish. */
    custom_host: string | null;
    /** Every host the site answers on. */
    hosts: string[];
    /** `on`: custom_host must be one of verified_domains. `off`: WS_DOMAIN_CHECK=off, any host is accepted. */
    check: 'on' | 'off';
    /** The organization's verified domains; null when the check is off or domain-service could not be asked. */
    verified_domains: string[] | null;
    /** Why verified_domains is null while the check is on. */
    verified_domains_error: string | null;
  };
  seo: {
    title: string | null;
    description: string | null;
    image: { id: string; url: string | null } | null;
  };
}

/** One request cannot be applied; the route turns it into the status. */
export class SiteSettingsError extends Error {
  constructor(
    public readonly kind: 'invalid' | 'domain_not_verified' | 'domain_check_unavailable',
    message: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'SiteSettingsError';
  }
}

/** Languages would be removed and the caller has not confirmed. Nothing was changed. */
export interface ConfirmationRequired {
  confirmation_required: true;
  remove: Array<{ code: string; label: string; translations: number }>;
}

async function publishedAt(): Promise<string | null> {
  const value = await getSettingByKey('published_at');
  return typeof value === 'string' ? value : null;
}

async function verifiedDomainsFor(site: Site, check: 'on' | 'off'): Promise<{ list: string[] | null; error: string | null }> {
  if (check === 'off') return { list: null, error: null };
  try {
    return { list: await listVerifiedDomains(site.organization_id), error: null };
  } catch (error) {
    if (error instanceof DomainCheckUnavailableError) return { list: null, error: error.message };
    throw error;
  }
}

async function seoImage(id: string | null): Promise<{ id: string; url: string | null } | null> {
  if (!id) return null;
  const asset = await getAssetById(id, false);
  return { id, url: asset ? getAssetProxyUrl(asset) || asset.public_url || null : null };
}

/** The settings of a live site; the caller has checked it belongs to the session's organization. */
export async function readSiteSettings(site: Site): Promise<SiteSettings> {
  return runWithSite(site.id, async () => {
    const check = domainCheckMode();
    const [locales, lastPublishedAt, seo, domains] = await Promise.all([
      getAllLocales(false),
      publishedAt(),
      getSettingsByKeys(Object.values(SEO_DEFAULT_KEYS)),
      verifiedDomainsFor(site, check),
    ]);
    const defaultHost = defaultHostFor(site.slug);
    return {
      id: site.id,
      name: site.name,
      slug: site.slug,
      status: lastPublishedAt ? 'published' : 'draft',
      last_published_at: lastPublishedAt,
      languages: locales.map((locale) => ({ code: locale.code, label: locale.label, is_default: locale.is_default })),
      default_language: locales.find((locale) => locale.is_default)?.code ?? null,
      domain: {
        default_host: defaultHost,
        custom_host: site.hosts.find((host) => host !== defaultHost) ?? null,
        hosts: site.hosts,
        check,
        verified_domains: domains.list,
        verified_domains_error: domains.error,
      },
      seo: {
        title: storedText(seo[SEO_DEFAULT_KEYS.title]),
        description: storedText(seo[SEO_DEFAULT_KEYS.description]),
        image: await seoImage(storedText(seo[SEO_DEFAULT_KEYS.image])),
      },
    };
  });
}

/** How many draft translations a locale has; they go with it. */
async function countTranslations(localeId: string): Promise<number> {
  const client = await getSupabaseAdmin();
  if (!client) throw new Error('Failed to initialize the database client');
  const { count, error } = await client
    .from('translations')
    .select('id', { count: 'exact', head: true })
    .eq('locale_id', localeId)
    .eq('is_published', false)
    .is('deleted_at', null);
  if (error) throw new Error(`Failed to count translations: ${error.message}`);
  return count ?? 0;
}

async function removeTranslations(localeId: string): Promise<void> {
  const client = await getSupabaseAdmin();
  if (!client) throw new Error('Failed to initialize the database client');
  const { error } = await client
    .from('translations')
    .update({ deleted_at: new Date().toISOString() })
    .eq('locale_id', localeId)
    .eq('is_published', false)
    .is('deleted_at', null);
  if (error) throw new Error(`Failed to remove translations: ${error.message}`);
}

async function checkCustomHost(site: Site, host: string): Promise<void> {
  if (site.is_template) {
    throw new SiteSettingsError('invalid', 'a template has no hosts: it is never published on a host', { field: 'custom_host' });
  }
  if (isSitesDomainName(host) && host !== defaultHostFor(site.slug)) {
    throw new SiteSettingsError('invalid', `${host} is under the sites domain; only a site's own slug can use it`, { field: 'custom_host' });
  }
  if (domainCheckMode() === 'off') return;
  let verified: string[];
  try {
    verified = await listVerifiedDomains(site.organization_id);
  } catch (error) {
    if (error instanceof DomainCheckUnavailableError) {
      throw new SiteSettingsError('domain_check_unavailable', `The organization's verified domains could not be read: ${error.message}`, { field: 'custom_host' });
    }
    throw error;
  }
  if (!isVerifiedDomain(host, verified)) {
    throw new SiteSettingsError('domain_not_verified', `${host} is not one of the organization's verified domains or a name under one`, { field: 'custom_host', verified_domains: verified });
  }
}

/**
 * Apply a patch to a site. Returns `ConfirmationRequired` (and changes nothing)
 * when it would remove languages and `confirm` is not true; otherwise the site's
 * settings afterwards. Throws `SiteSettingsError` for a request that cannot be
 * applied and `SiteConflictError` for a slug or host another site uses.
 */
export async function applySiteSettings(site: Site, patch: SiteSettingsPatch): Promise<SiteSettings | ConfirmationRequired> {
  const outcome = await runWithSite(site.id, async (): Promise<ConfirmationRequired | 'applied'> => {
    // 1. Everything that can be refused, before the first write.
    const locales = await getAllLocales(false);
    const touchesLanguages = patch.languages !== undefined || patch.default_language !== undefined;
    const plan = touchesLanguages ? planLanguages(locales, patch.languages, patch.default_language) : null;
    if (plan && 'error' in plan) throw new SiteSettingsError('invalid', plan.error, { field: 'languages' });

    if (plan && plan.remove.length && patch.confirm !== true) {
      const removing = locales.filter((locale) => plan.remove.includes(locale.code));
      return {
        confirmation_required: true,
        remove: await Promise.all(removing.map(async (locale) => ({ code: locale.code, label: locale.label, translations: await countTranslations(locale.id) }))),
      };
    }

    const defaultHost = defaultHostFor(site.slug);
    const currentCustom = site.hosts.find((host) => host !== defaultHost) ?? null;
    const customChanges = patch.custom_host !== undefined && patch.custom_host !== currentCustom;
    if (customChanges && patch.custom_host) await checkCustomHost(site, patch.custom_host);

    if (patch.seo?.image) {
      if (!(await getAssetById(patch.seo.image, false))) {
        throw new SiteSettingsError('invalid', 'seo.image is not an asset of this site', { field: 'seo.image' });
      }
    }

    // 2. The slug and the host first: they are the ones another site can contest.
    if (patch.slug !== undefined && patch.slug !== site.slug) await changeSiteSlug(site.id, patch.slug);
    if (customChanges) await setCustomHosts(site.id, patch.custom_host ? [patch.custom_host] : []);

    // 3. Name and SEO defaults are settings; setSettings keeps platform_sites.name equal to site_name.
    const settings: Record<string, string | null> = {};
    if (patch.name !== undefined) settings.site_name = patch.name;
    if (patch.seo?.title !== undefined) settings[SEO_DEFAULT_KEYS.title] = patch.seo.title;
    if (patch.seo?.description !== undefined) settings[SEO_DEFAULT_KEYS.description] = patch.seo.description;
    if (patch.seo?.image !== undefined) settings[SEO_DEFAULT_KEYS.image] = patch.seo.image;
    if (Object.keys(settings).length) await setSettings(settings);

    // 4. Languages: add, then the default, then remove, so the default is never one that goes.
    if (plan) {
      for (const code of plan.add) {
        await createLocale({ code, label: catalogLocale(code)?.label ?? code, is_default: false });
      }
      const afterAdd = await getAllLocales(false);
      const wanted = afterAdd.find((locale) => locale.code === plan.defaultCode);
      if (wanted && !wanted.is_default) {
        // The source text follows the default language (OPEN_QUESTIONS 24): the new default's
        // translations go into the pages, and the old default's text becomes its translations
        // unless it is being removed. The flag moves in the same transaction.
        const current = afterAdd.find((locale) => locale.is_default);
        if (current) await swapSiteSourceLanguage(site.id, current, wanted, !plan.remove.includes(current.code));
        else await setDefaultLocale(wanted.id);
      }
      for (const code of plan.remove) {
        const locale = afterAdd.find((candidate) => candidate.code === code);
        if (!locale) continue;
        await deleteLocale(locale.id);
        await removeTranslations(locale.id);
      }
      await setSiteDefaultLocale(site.id, plan.defaultCode);
    }

    // 5. The published pages' head, name and hreflang read these; drop this site's cached pages.
    if (patch.name !== undefined || patch.seo !== undefined || plan) await clearAllCache();
    return 'applied';
  });

  if (outcome !== 'applied') return outcome;
  const fresh = await getSiteForOrganization(site.id, site.organization_id);
  if (!fresh) throw new Error('The site disappeared while its settings were being saved');
  return readSiteSettings(fresh);
}
