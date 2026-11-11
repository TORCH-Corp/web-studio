import { NextRequest } from 'next/server';
import { noCache } from '@/lib/api-response';
import { siteReportRequest } from '@/lib/platform/report-request';
import { conversionsReport } from '@/lib/platform/reports';

/**
 * GET /ycode/api/platform/sites/{id}/reports/conversions (part 3, session W9; PRD V1.0 "Conversions report"): one
 * site's visitors and what they did, for the Tauri app's Conversions screen. Permission, site and period are the
 * Traffic report's (see its route): `webstudio.manage_reports` r, a site of the organization, `?period=` or
 * `?from=&to=`.
 *
 *   → { data: {
 *         period: { key, from, to, days },
 *         no_data: true when no shown step has a count: the counts are zeros and the shares null, the answer is 200,
 *         sells: whether the site's store sells,
 *         steps: [{ step: visitors | cart | orders | forms, count, share }]  in this order,
 *       } }
 *     visitors  visitors with a counted view, once a day, added up over the period
 *     cart      visitors who added to the cart, once a day
 *     orders    orders placed: every one counts, a visitor who orders twice is two
 *     forms     form submissions that were not spam, every form on the site
 *     share     the count as a percentage of the visitors, one decimal, at most 100, null when there are no visitors
 *   A site that does not sell has `sells: false` and the steps visitors and forms only: the cart and orders steps are
 *   absent, whatever the site holds of them.
 */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const checked = await siteReportRequest(request, id);
  if (!checked.ok) return checked.response;

  try {
    return noCache({ data: await conversionsReport(checked.site, checked.period) });
  } catch (error) {
    console.error('[GET /ycode/api/platform/sites/{id}/reports/conversions]', error);
    return noCache({ error: 'Failed to read the conversions report' }, 500);
  }
}
