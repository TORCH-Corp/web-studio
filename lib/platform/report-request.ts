/**
 * What the three report routes check before they read anything (part 3, session W9): the session, the site, the
 * period. `webstudio.manage_reports` r is the proxy's check (lib/platform/permissions.ts); a request that gets here
 * holds it.
 *
 * Order: no session is 401; a site that is not one of the session's organization (or does not exist, or the id is not
 * an id) is 404, whatever else the request says, so a stranger learns nothing of the site's existence from the
 * period's errors; then the period: 400 `{ error, code: 'invalid_period' }` with what to change.
 */

import type { NextRequest, NextResponse } from 'next/server';
import { noCache } from '@/lib/api-response';
import { parseReportPeriod, type ReportPeriod } from '@/lib/platform/report-period';
import { today } from '@/lib/platform/reports';
import { getSessionFromCookies, getSiteForOrganization, type Site } from '@/lib/platform/site';

type Refusal = { ok: false; response: NextResponse };

function periodOf(request: NextRequest): { ok: true; period: ReportPeriod } | Refusal {
  const result = parseReportPeriod(new URL(request.url).searchParams, today());
  return result.ok ? result : { ok: false, response: noCache({ error: result.message, code: 'invalid_period' }, 400) };
}

/** The site and the period of a site report: GET .../sites/{id}/reports/traffic and .../conversions. */
export async function siteReportRequest(request: NextRequest, siteId: string): Promise<{ ok: true; site: Site; period: ReportPeriod } | Refusal> {
  const session = await getSessionFromCookies();
  if (!session) return { ok: false, response: noCache({ error: 'Not authenticated' }, 401) };
  const site = await getSiteForOrganization(siteId, session.org);
  if (!site) return { ok: false, response: noCache({ error: 'Site not found' }, 404) };
  const period = periodOf(request);
  return period.ok ? { ok: true, site, period: period.period } : period;
}

/** The organization and the period of the summary: GET .../reports/summary. */
export async function summaryRequest(request: NextRequest): Promise<{ ok: true; organizationId: string; period: ReportPeriod } | Refusal> {
  const session = await getSessionFromCookies();
  if (!session) return { ok: false, response: noCache({ error: 'Not authenticated' }, 401) };
  const period = periodOf(request);
  return period.ok ? { ok: true, organizationId: session.org, period: period.period } : period;
}
