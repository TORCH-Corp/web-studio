import { NextRequest } from 'next/server';
import { noCache } from '@/lib/api-response';
import { getSessionFromCookies, listSites } from '@/lib/platform/site';
import { parseSiteInput } from '@/lib/platform/site-input';
import { provisionSite, SiteConflictError } from '@/lib/platform/provision';

/**
 * Sites API (part 1, session 1): the sites of the session's organization.
 *
 *   GET  /ycode/api/platform/sites   the organization's live sites with status, hosts, last publish
 *   POST /ycode/api/platform/sites   create a blank site (name, slug, languages, default_language,
 *                                    optional hosts; template_id is accepted and ignored until session 4)
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

  try {
    const site = await provisionSite({ ...input, organizationId: session.org, createdBy: session.sub });
    return noCache({ data: site }, 201);
  } catch (error) {
    if (error instanceof SiteConflictError) return noCache({ error: error.message, field: error.field }, 409);
    console.error('[POST /ycode/api/platform/sites]', error);
    return noCache({ error: 'Failed to create site' }, 500);
  }
}
