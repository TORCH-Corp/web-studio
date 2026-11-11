import { NextRequest } from 'next/server';
import { noCache } from '@/lib/api-response';
import { siteReportRequest } from '@/lib/platform/report-request';
import { trafficReport } from '@/lib/platform/reports';

/**
 * GET /ycode/api/platform/sites/{id}/reports/traffic (part 3, session W9; PRD V1.0 "Traffic report"): one site's
 * visits for the Tauri app's Traffic screen. `webstudio.manage_reports` r is the proxy's check
 * (lib/platform/permissions.ts); a site of another organization, or one that does not exist, is not found.
 *
 * The period is `?period=today|last_7_days|last_30_days`, or `?from=YYYY-MM-DD&to=YYYY-MM-DD` in the platform's days
 * (Baghdad time), at most 366 of them, ending no later than today: 400 `{ error, code: 'invalid_period' }` otherwise.
 * Today is read from the detailed rows, finished days from the daily totals (lib/platform/reports.ts).
 *
 *   → { data: {
 *         period: { key, from, to, days },
 *         no_data: true when the period has no view: the numbers are zeros and the lists empty, the answer is 200,
 *         views,
 *         visitors_per_day: the average over the period's days, one decimal (the series holds each day's value),
 *         series: [{ day, views, visitors }]  one per day, oldest first, a day with no visit with zeros,
 *         pages: { total: pages viewed, top: [{ path, name | null, views, share }] }  the 6 most viewed, share of all views,
 *         sources: [{ source: direct | search | social | referral, views, share }]  all four, in this order; referral is "another site",
 *         devices: [{ device: phone | desktop | tablet, views, share }]  all three, in this order,
 *       } }
 *     shares are percentages with one decimal that add up to exactly 100.0 over a whole list (sources, devices, all pages).
 *     name is the page's name in the builder, null when no page has that path now. No countries (plan decision 20d).
 */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const checked = await siteReportRequest(request, id);
  if (!checked.ok) return checked.response;

  try {
    return noCache({ data: await trafficReport(checked.site, checked.period) });
  } catch (error) {
    console.error('[GET /ycode/api/platform/sites/{id}/reports/traffic]', error);
    return noCache({ error: 'Failed to read the traffic report' }, 500);
  }
}
