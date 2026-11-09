import { noCache } from '@/lib/api-response';
import { getSessionFromCookies } from '@/lib/platform/site';
import { listTemplates } from '@/lib/platform/templates';

/**
 * GET /ycode/api/platform/templates (part 1, session 4): TORCH's templates,
 * the same for every organization, each with its name and description in
 * Arabic and English, its `page_count` (the pages a site made from it starts
 * with, the error pages left out) and its `languages` (locale codes, the
 * default first), which the cards' "5 pages · Arabic · English" line reads
 * (part 2 release fixes). Read-only. The permission check is the proxy's
 * (lib/platform/permissions.ts): manage_sites r.
 */
export async function GET() {
  const session = await getSessionFromCookies();
  if (!session) return noCache({ error: 'Not authenticated' }, 401);
  try {
    return noCache({ data: await listTemplates() });
  } catch (error) {
    console.error('[GET /ycode/api/platform/templates]', error);
    return noCache({ error: 'Failed to list templates' }, 500);
  }
}
