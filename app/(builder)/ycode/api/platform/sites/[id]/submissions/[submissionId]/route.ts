import { noCache } from '@/lib/api-response';
import { deleteSubmission, readSubmission } from '@/lib/platform/submissions';
import { getSessionFromCookies, getSiteForOrganization } from '@/lib/platform/site';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Context = { params: Promise<{ id: string; submissionId: string }> };

/**
 * GET /ycode/api/platform/sites/{id}/submissions/{submissionId} (part 3, session
 * W4; PRD V1.0 "Submissions in Web Studio"): one submission of a site of the
 * session's organization with every field the visitor sent. `webstudio.manage_forms`
 * r is the proxy's check; the logic is lib/platform/submissions.ts.
 *
 *   → { data: { id, date, form: { id, name }, sender: { name, phone }, unread, contact_center: { state, kind, id },
 *               fields: [{ name, label, value }],
 *               links: { open_in_contact_center } } }
 *     fields  what the visitor sent, in the form's field order with the form's labels; a field the form does not have
 *             follows under its own name, and a field of the form that was not sent is not listed. value is text, or a
 *             list of text for a field sent more than once
 *     links   `torch://app/<CONTACT_CENTER_APP_ID>/prospects/{id}` or `.../contacts/persons/{id}`, the way the shell
 *             opens Contact Center; null while the state is 'waiting' or 'stored', and without CONTACT_CENTER_APP_ID
 *   Reading it sets it 'read' (the answer says unread: false). The visitor's IP address and user agent are never answered.
 *
 * 404 no such site, or no such submission in it (a submission of another site or organization, and spam, are none).
 */
export async function GET(_request: Request, context: Context) {
  const session = await getSessionFromCookies();
  if (!session) return noCache({ error: 'Not authenticated' }, 401);

  const { id, submissionId } = await context.params;
  const site = await getSiteForOrganization(id, session.org);
  if (!site) return noCache({ error: 'Site not found' }, 404);
  if (!UUID_PATTERN.test(submissionId)) return noCache({ error: 'Submission not found' }, 404);

  try {
    const submission = await readSubmission(site, submissionId.toLowerCase());
    if (!submission) return noCache({ error: 'Submission not found' }, 404);
    return noCache({ data: submission });
  } catch (error) {
    console.error('[GET /ycode/api/platform/sites/{id}/submissions/{submissionId}]', error);
    return noCache({ error: 'Failed to read the submission' }, 500);
  }
}

/**
 * DELETE /ycode/api/platform/sites/{id}/submissions/{submissionId}: deletes the
 * submission and its link row. `webstudio.manage_forms` d is the proxy's check.
 * It never calls Contact Center: the prospect or contact the submission became
 * stays there. This is not an edit of the site (the proxy asks for no editor
 * lock under /ycode/api/platform/).
 *
 *   → { data: { id } } · 404 no such site, or no such submission in it
 */
export async function DELETE(_request: Request, context: Context) {
  const session = await getSessionFromCookies();
  if (!session) return noCache({ error: 'Not authenticated' }, 401);

  const { id, submissionId } = await context.params;
  const site = await getSiteForOrganization(id, session.org);
  if (!site) return noCache({ error: 'Site not found' }, 404);
  if (!UUID_PATTERN.test(submissionId)) return noCache({ error: 'Submission not found' }, 404);

  try {
    if (!(await deleteSubmission(site, submissionId.toLowerCase()))) return noCache({ error: 'Submission not found' }, 404);
    return noCache({ data: { id: submissionId.toLowerCase() } });
  } catch (error) {
    console.error('[DELETE /ycode/api/platform/sites/{id}/submissions/{submissionId}]', error);
    return noCache({ error: 'Failed to delete the submission' }, 500);
  }
}
