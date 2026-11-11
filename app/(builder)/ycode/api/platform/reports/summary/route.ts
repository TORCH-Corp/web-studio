import { NextRequest } from 'next/server';
import { noCache } from '@/lib/api-response';
import { summaryRequest } from '@/lib/platform/report-request';
import { summaryReport } from '@/lib/platform/reports';

/**
 * GET /ycode/api/platform/reports/summary (part 3, session W9; PRD V1.0 "Dashboard", the visits summary): the
 * organization's sites and their visits, for the Tauri app's Dashboard. `webstudio.manage_reports` r is the proxy's
 * check; the period is the Traffic report's (`?period=` or `?from=&to=`, see its route).
 *
 *   → { data: {
 *         period: { key, from, to, days },
 *         no_data: true when no site had a view or a visitor in the period (also for an organization with no site),
 *         total: { views, visitors_per_day }  summed over the sites with numbers; visitors_per_day is the visitors of
 *                all of them over the period's days, one decimal,
 *         sites: [{ id, name, status: draft | published, views, visitors_per_day,
 *                   views_by_day: [{ day, views }] }]  the sites of the organization, oldest first, one entry per day,
 *       } }
 *   A site that was never published (`status: 'draft'`) has no numbers: views, visitors_per_day and views_by_day are
 *   null, not zero, and it adds nothing to the total.
 */
export async function GET(request: NextRequest) {
  const checked = await summaryRequest(request);
  if (!checked.ok) return checked.response;

  try {
    return noCache({ data: await summaryReport(checked.organizationId, checked.period) });
  } catch (error) {
    console.error('[GET /ycode/api/platform/reports/summary]', error);
    return noCache({ error: 'Failed to read the visit summary' }, 500);
  }
}
