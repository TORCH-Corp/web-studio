import { noCache } from '@/lib/api-response';
import { hasFlag } from '@/lib/platform/session';
import { getSessionFromCookies } from '@/lib/platform/site';
import { listTemplates } from '@/lib/platform/templates';

/**
 * GET /ycode/api/platform/templates (part 1, session 4): TORCH's templates,
 * the same for every organization, each with its name and description in
 * Arabic and English. Read-only; needs `webstudio.manage_sites` r. The
 * check is made here until session 2's route map covers every route.
 */
export async function GET() {
  const session = await getSessionFromCookies();
  if (!session) return noCache({ error: 'Not authenticated' }, 401);
  if (!hasFlag(session, 'webstudio.manage_sites', 'r')) return noCache({ error: 'Forbidden' }, 403);
  try {
    return noCache({ data: await listTemplates() });
  } catch (error) {
    console.error('[GET /ycode/api/platform/templates]', error);
    return noCache({ error: 'Failed to list templates' }, 500);
  }
}
