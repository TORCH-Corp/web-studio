import { NextRequest } from 'next/server';
import { noCache } from '@/lib/api-response';
import { getSessionFromCookies, listSites } from '@/lib/platform/site';
import { parseSiteInput, templateMetaFor } from '@/lib/platform/site-input';
import { provisionSite, seedBlankSite, SiteConflictError, type SiteSeeder } from '@/lib/platform/provision';
import { copyTemplate, TemplateCopyError } from '@/lib/platform/template-copy';
import { getTemplate, isBlankTemplate, isTemplatesOrganization } from '@/lib/platform/templates';

/**
 * Sites API (part 1, sessions 1 and 4): the sites of the session's organization.
 *
 *   GET  /ycode/api/platform/sites   the organization's live sites with status, hosts, last publish
 *   POST /ycode/api/platform/sites   create a site (name, slug, languages, default_language, optional
 *                                    hosts): blank, or a copy of the template named by template_id
 *                                    (404 when there is no such template). The templates organization
 *                                    may send is_template with the template's Arabic and English name
 *                                    and description (400 from anyone else, or with hosts).
 *
 * The organization is the session's. The permission checks are the proxy's
 * (lib/platform/permissions.ts): manage_sites r for GET, c for POST.
 */
export async function GET() {
  const session = await getSessionFromCookies();
  if (!session) return noCache({ error: 'Not authenticated' }, 401);
  try {
    return noCache({ data: await listSites(session.org) });
  } catch (error) {
    console.error('[GET /ycode/api/platform/sites]', error);
    return noCache({ error: 'Failed to list sites' }, 500);
  }
}

export async function POST(request: NextRequest) {
  const session = await getSessionFromCookies();
  if (!session) return noCache({ error: 'Not authenticated' }, 401);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return noCache({ error: 'The body must be JSON' }, 400);
  }
  const { input, errors } = parseSiteInput(body);
  if (!input) return noCache({ error: 'Invalid site', details: errors }, 400);

  if (input.is_template && !isTemplatesOrganization(session.org)) {
    return noCache({ error: 'Only the TORCH templates organization creates templates', details: ['is_template: not allowed for this organization'] }, 400);
  }

  let seed: SiteSeeder = seedBlankSite;
  if (input.template_id) {
    const template = await getTemplate(input.template_id);
    if (!template) return noCache({ error: 'Template not found' }, 404);
    if (!isBlankTemplate(template)) seed = copyTemplate(template);
  }

  try {
    const site = await provisionSite({
      ...input,
      organizationId: session.org,
      createdBy: session.sub,
      isTemplate: input.is_template ?? false,
      templateMeta: input.is_template ? templateMetaFor(input) : undefined,
    }, seed);
    return noCache({ data: site }, 201);
  } catch (error) {
    if (error instanceof SiteConflictError) return noCache({ error: error.message, field: error.field }, 409);
    if (error instanceof TemplateCopyError) {
      console.error('[POST /ycode/api/platform/sites] template copy failed', error);
      return noCache({ error: error.message }, 500);
    }
    console.error('[POST /ycode/api/platform/sites]', error);
    return noCache({ error: 'Failed to create site' }, 500);
  }
}
