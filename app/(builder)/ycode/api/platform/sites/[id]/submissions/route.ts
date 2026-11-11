import { NextRequest } from 'next/server';
import { noCache } from '@/lib/api-response';
import { listSubmissions } from '@/lib/platform/submissions';
import { parseSubmissionsQuery } from '@/lib/platform/submissions-view';
import { getSessionFromCookies, getSiteForOrganization } from '@/lib/platform/site';

/**
 * GET /ycode/api/platform/sites/{id}/submissions (part 3, session W4; PRD V1.0
 * "Submissions in Web Studio"): the form submissions of one site of the
 * session's organization, for the Tauri app's Contact form list, newest first.
 * `webstudio.manage_forms` r is the proxy's check (lib/platform/permissions.ts);
 * the logic is lib/platform/submissions.ts. A site of another organization, or
 * one that does not exist, is not found.
 *
 *   GET ?form_id=&unread=&cursor=&limit=
 *     form_id  only this form's submissions (the id of a form in `.../submissions/forms`)
 *     unread   true: only the unread; false: only the read; absent: both
 *     cursor   next_cursor of the page before; limit 1 to 100, 25 by default
 *   → { data: [{ id, date, form: { id, name }, sender: { name, phone }, unread,
 *                contact_center: { state, kind, id } }], next_cursor }
 *     date            ISO date the visitor sent it
 *     sender          the payload's `name` and `phone` fields; null for one the form does not have (the app shows "Not given")
 *     unread          the status is 'new'; reading a submission (`.../submissions/{id}`) sets it 'read'
 *     contact_center  what became of it: state 'stored' (only here), 'waiting' (Contact Center was not reachable, the
 *                     retry asks again), 'prospect' or 'contact'; kind and id name the Contact Center record, null
 *                     for 'stored' and 'waiting'
 *     next_cursor     null on the last page
 *   Spam is never listed. The visitor's IP address and user agent are never answered.
 *
 * 400 an invalid query, or { code: 'invalid_cursor' } · 404 no such site.
 */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await getSessionFromCookies();
  if (!session) return noCache({ error: 'Not authenticated' }, 401);

  const { id } = await context.params;
  const site = await getSiteForOrganization(id, session.org);
  if (!site) return noCache({ error: 'Site not found' }, 404);

  const parsed = parseSubmissionsQuery(request.nextUrl.searchParams);
  if (!parsed.query) return noCache({ error: 'Invalid query', ...(parsed.code ? { code: parsed.code } : {}), details: parsed.errors }, 400);

  try {
    const page = await listSubmissions(site, parsed.query);
    return noCache({ data: page.rows, next_cursor: page.nextCursor });
  } catch (error) {
    console.error('[GET /ycode/api/platform/sites/{id}/submissions]', error);
    return noCache({ error: 'Failed to list the site\'s submissions' }, 500);
  }
}
