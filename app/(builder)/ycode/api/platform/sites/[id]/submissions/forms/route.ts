import { noCache } from '@/lib/api-response';
import { listSiteForms } from '@/lib/platform/submissions';
import { getSessionFromCookies, getSiteForOrganization } from '@/lib/platform/site';

/**
 * GET /ycode/api/platform/sites/{id}/submissions/forms (part 3, session W4): the
 * forms of one site of the session's organization with their names, for the
 * Contact form list's filter. `webstudio.manage_forms` r is the proxy's check.
 * A site of another organization, or one that does not exist, is not found.
 *
 *   → { data: [{ id, name }] }, by name without regard to case
 *     id    the form's id (`settings.id` of the form layer): what `form_id` of the list takes
 *     name  the form layer's own name in the builder's layers panel; the id when it has none
 *   The forms in the site's layers (published or draft) and any form that has submissions, a form no layer holds
 *   any more included, under its id. A form nobody has written to is listed.
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getSessionFromCookies();
  if (!session) return noCache({ error: 'Not authenticated' }, 401);

  const { id } = await context.params;
  const site = await getSiteForOrganization(id, session.org);
  if (!site) return noCache({ error: 'Site not found' }, 404);

  try {
    return noCache({ data: await listSiteForms(site) });
  } catch (error) {
    console.error('[GET /ycode/api/platform/sites/{id}/submissions/forms]', error);
    return noCache({ error: 'Failed to list the site\'s forms' }, 500);
  }
}
