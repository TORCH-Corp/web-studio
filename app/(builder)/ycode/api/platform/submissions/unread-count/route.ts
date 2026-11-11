import { noCache } from '@/lib/api-response';
import { unreadCounts } from '@/lib/platform/submissions';
import { getSessionFromCookies } from '@/lib/platform/site';

/**
 * GET /ycode/api/platform/submissions/unread-count (part 3, session W4; PRD V1.0
 * "Submissions in Web Studio"): the unread form submissions of the session's
 * organization and of each of its sites, for the Navigator's count and the
 * Dashboard. `webstudio.manage_forms` r is the proxy's check; the logic is
 * lib/platform/submissions.ts.
 *
 *   → { data: { count, sites: [{ id, count }] } }
 *     count  the organization's: every live site's unread submissions together
 *     sites  every live site of the organization, oldest first, with its own count (0 when none)
 *   Unread is the status 'new'; spam is never counted, and a deleted site's submissions are not.
 */
export async function GET() {
  const session = await getSessionFromCookies();
  if (!session) return noCache({ error: 'Not authenticated' }, 401);

  try {
    return noCache({ data: await unreadCounts(session.org) });
  } catch (error) {
    console.error('[GET /ycode/api/platform/submissions/unread-count]', error);
    return noCache({ error: 'Failed to count the unread submissions' }, 500);
  }
}
