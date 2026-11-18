import { NextRequest } from 'next/server';
import { noCache } from '@/lib/api-response';
import { deleteSubmissions, listSubmissions, setSubmissionsStatus } from '@/lib/platform/submissions';
import { parseSubmissionIds, parseSubmissionStatus, parseSubmissionsQuery, SUBMISSION_STATUSES } from '@/lib/platform/submissions-view';
import { getSessionFromCookies, getSiteForOrganization } from '@/lib/platform/site';

/**
 * GET /ycode/api/platform/sites/{id}/submissions (part 3, session W4; PRD V1.0
 * "Submissions in Web Studio"): the form submissions of one site of the
 * session's organization, for the Tauri app's Contact form list, newest first.
 * `webstudio.manage_forms` r is the proxy's check (lib/platform/permissions.ts);
 * the logic is lib/platform/submissions.ts. A site of another organization, or
 * one that does not exist, is not found.
 *
 *   GET ?form_id=&show=&q=&cursor=&limit=
 *     form_id  only this form's submissions (the id of a form in `.../submissions/forms`)
 *     show     all (the inbox: unread and read; the default), unread, read, archived, spam
 *     q        only submissions one of whose sent values holds this text, without regard to case
 *     unread   the first version's filter: true is show=unread, false is show=read
 *     cursor   next_cursor of the page before; limit 1 to 100, 25 by default
 *   → { data: [{ id, date, form: { id, name }, sender: { name, phone }, unread, status,
 *                contact_center: { state, kind, id } }], next_cursor }
 *     date            ISO date the visitor sent it
 *     sender          the payload's `name` and `phone` fields; null for one the form does not have (the app shows "Not given")
 *     unread          the status is 'new'; reading a submission (`.../submissions/{id}`) sets it 'read'
 *     contact_center  what became of it: state 'stored' (only here), 'waiting' (Contact Center was not reachable, the
 *                     retry asks again), 'prospect' or 'contact'; kind and id name the Contact Center record, null
 *                     for 'stored' and 'waiting'
 *     next_cursor     null on the last page
 *     status          'new' (unread), 'read', 'archived' or 'spam'
 *   Archived submissions and spam are listed only by their own `show`. The visitor's IP address and user agent are
 *   never answered.
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

/**
 * PATCH /ycode/api/platform/sites/{id}/submissions (17 Nov 2026): sets the status of several submissions of the
 * site at once. `webstudio.manage_forms` u is the proxy's check. Contact Center is never called.
 *
 *   PATCH { ids: [submission id, 1 to 100], status: 'new' | 'read' | 'archived' | 'spam' }
 *   → { data: { ids } }   the submissions of the site among those named; an id the site does not have is left out
 *
 * 400 an invalid body · 404 no such site.
 */
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
    return noCache({ error: 'Invalid body', details: ['the body is not JSON'] }, 400);
  }
  const { ids: rawIds, status: rawStatus } = (typeof body === 'object' && body !== null ? body : {}) as { ids?: unknown; status?: unknown };
  const parsed = parseSubmissionIds(rawIds);
  const status = parseSubmissionStatus(rawStatus);
  const details = [...(parsed.error ? [parsed.error] : []), ...(status ? [] : [`status: one of ${SUBMISSION_STATUSES.join(', ')}`])];
  if (!parsed.ids || !status) return noCache({ error: 'Invalid body', details }, 400);

  try {
    return noCache({ data: { ids: await setSubmissionsStatus(site, parsed.ids, status) } });
  } catch (error) {
    console.error('[PATCH /ycode/api/platform/sites/{id}/submissions]', error);
    return noCache({ error: 'Failed to change the submissions' }, 500);
  }
}

/**
 * DELETE /ycode/api/platform/sites/{id}/submissions?ids=a,b,c (17 Nov 2026): deletes several submissions of the
 * site and their link rows. `webstudio.manage_forms` d is the proxy's check. Contact Center is never called. The
 * ids are in the query: a DELETE with a body does not pass every proxy.
 *
 *   → { data: { ids } }   the submissions that were deleted; an id the site does not have is left out
 *
 * 400 invalid ids · 404 no such site.
 */
export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await getSessionFromCookies();
  if (!session) return noCache({ error: 'Not authenticated' }, 401);

  const { id } = await context.params;
  const site = await getSiteForOrganization(id, session.org);
  if (!site) return noCache({ error: 'Site not found' }, 404);

  const parsed = parseSubmissionIds((request.nextUrl.searchParams.get('ids') ?? '').split(',').filter(Boolean));
  if (!parsed.ids) return noCache({ error: 'Invalid query', details: [parsed.error] }, 400);

  try {
    return noCache({ data: { ids: await deleteSubmissions(site, parsed.ids) } });
  } catch (error) {
    console.error('[DELETE /ycode/api/platform/sites/{id}/submissions]', error);
    return noCache({ error: 'Failed to delete the submissions' }, 500);
  }
}
