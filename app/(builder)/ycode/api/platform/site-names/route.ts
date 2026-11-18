import { noCache } from '@/lib/api-response';
import { getKnexClient } from '@/lib/knex-client';
import { getSessionFromCookies } from '@/lib/platform/site';

/**
 * GET /ycode/api/platform/site-names (17 Nov 2026): the id and name of the session's organization's live sites,
 * by name. It is for the Site picker of the app's Collections and Contact form pages, which a user who holds
 * `manage_content` or `manage_forms` and not `manage_sites` opens too: the full list (`platform/sites`) is the
 * sites leaf's and would refuse them. Any signed-in user of the organization may read it; it says nothing but
 * which sites exist and what they are called.
 *
 *   → { data: [{ id, name }] }
 */
export async function GET() {
  const session = await getSessionFromCookies();
  if (!session) return noCache({ error: 'Not authenticated' }, 401);

  try {
    const knex = await getKnexClient();
    const rows = (await knex('platform_sites')
      .where('organization_id', session.org)
      .whereNull('deleted_at')
      .orderByRaw('lower(name) asc, id asc')
      .select('id', 'name')) as Array<{ id: string; name: string }>;
    return noCache({ data: rows });
  } catch (error) {
    console.error('[GET /ycode/api/platform/site-names]', error);
    return noCache({ error: 'Failed to list the sites' }, 500);
  }
}
