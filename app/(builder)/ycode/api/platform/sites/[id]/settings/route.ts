import { NextRequest } from 'next/server';
import { noCache } from '@/lib/api-response';
import { getSessionFromCookies, getSiteForOrganization } from '@/lib/platform/site';
import { SiteConflictError } from '@/lib/platform/provision';
import { parseSiteSettingsPatch } from '@/lib/platform/site-settings-input';
import { applySiteSettings, readSiteSettings, SiteSettingsError } from '@/lib/platform/site-settings';

/**
 * Site settings (part 1, session 7): what the Tauri app's Site settings screen
 * shows and saves, for one site of the session's organization. A site of
 * another organization is not found. The permission checks are the proxy's
 * (lib/platform/permissions.ts): manage_sites r for GET, u for PATCH.
 *
 *   GET   → { data: { name, slug, status, languages, default_language,
 *                     domain: { default_host, custom_host, hosts, check, verified_domains, … },
 *                     seo: { title, description, image } } }
 *   PATCH → the same document afterwards. The body names what changes:
 *           name, slug, languages + default_language, custom_host (null removes it),
 *           seo { title, description, image } (null removes one), confirm.
 *           Removing a language removes its translations; the first call answers
 *           409 { error: 'confirmation_required', remove: [...] } and changes nothing,
 *           the second, with confirm: true, does it.
 *
 * 400 invalid body · 404 no such site · 409 slug or host in use, or confirmation
 * required · 422 custom_host is not a verified domain · 503 the verified domains
 * could not be read (domain-service), so the host is not accepted.
 */
export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await getSessionFromCookies();
  if (!session) return noCache({ error: 'Not authenticated' }, 401);

  const { id } = await context.params;
  const site = await getSiteForOrganization(id, session.org);
  if (!site) return noCache({ error: 'Site not found' }, 404);

  try {
    return noCache({ data: await readSiteSettings(site) });
  } catch (error) {
    console.error('[GET /ycode/api/platform/sites/{id}/settings]', error);
    return noCache({ error: 'Failed to read the site settings' }, 500);
  }
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await getSessionFromCookies();
  if (!session) return noCache({ error: 'Not authenticated' }, 401);

  const { id } = await context.params;
  const site = await getSiteForOrganization(id, session.org);
  if (!site) return noCache({ error: 'Site not found' }, 404);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return noCache({ error: 'The body must be JSON' }, 400);
  }
  const { patch, errors } = parseSiteSettingsPatch(body);
  if (!patch) return noCache({ error: 'Invalid site settings', details: errors }, 400);

  try {
    const result = await applySiteSettings(site, patch);
    if ('confirmation_required' in result) {
      return noCache({ error: 'confirmation_required', message: 'Removing these languages deletes their translations. Send the request again with confirm: true.', remove: result.remove }, 409);
    }
    return noCache({ data: result });
  } catch (error) {
    if (error instanceof SiteConflictError) return noCache({ error: error.message, field: error.field }, 409);
    if (error instanceof SiteSettingsError) {
      const status = error.kind === 'invalid' ? 400 : error.kind === 'domain_not_verified' ? 422 : 503;
      return noCache({ error: error.message, code: error.kind, ...error.details }, status);
    }
    console.error('[PATCH /ycode/api/platform/sites/{id}/settings]', error);
    return noCache({ error: 'Failed to save the site settings' }, 500);
  }
}
