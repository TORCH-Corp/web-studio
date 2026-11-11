import { NextResponse, type NextRequest } from 'next/server';
import { noCache } from '@/lib/api-response';
import { getClientIp, isSameOriginRequest } from '@/lib/request-utils';
import { getSite, siteIdForHost, type Site } from '@/lib/platform/site';
import { countEvent, visitorOf } from '@/lib/platform/visit-events';
import { visitCounter } from '@/lib/platform/visit-limit';
import { MAX_VISIT_BYTES, parseReport, sourceOf } from '@/lib/platform/visit-rules';
import { recordView } from '@/lib/platform/visits';

export const dynamic = 'force-dynamic';

const ROUTE = 'POST /ycode/api/visits';

/** The answer to a view, counted or not: nothing to read, never kept. */
const done = () => new NextResponse(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });

const refused = (status: number, error: string, code: string) => noCache({ error, code }, status);

/**
 * POST /ycode/api/visits (part 3, session W7; a published page calls it as
 * `/studio/api/visits`): what a published page reports to its own host, sent by
 * the page itself (lib/platform/VisitBeacon.tsx, lib/platform/visit-client.ts).
 * Anonymous, on the site's own host only. Two things can be reported:
 *
 *   { page_id: uuid, path: '/about', referrer: 'www.google.com' | '' }
 *       one view of a published page, sent once the page is on the visitor's
 *       screen (`kind: 'view'` may be said; it is the default)
 *   { kind: 'add_to_cart' }
 *       the store's add to cart (session W8): the visitor's one add to cart of the
 *       day. Nothing else in the body is read; an order and a form submission are
 *       written by the server, never reported here, so any other kind is 400.
 *
 * `referrer` is the host of the page's referrer and is used for the source
 * only. The IP address and the user agent are read for the visitor key of the
 * day and the device type; none of the three is stored or logged
 * (lib/platform/visit-rules.ts).
 *
 *   204  the report was read. It is stored unless it came from a known bot, a
 *        prefetch, a signed-in Business OS user (an editor looking at his own
 *        site where his session reaches), a view of a page that is not a
 *        published page of this site, an add to cart the visitor already made
 *        today, or the count failed (logged; the page never knows)
 *   400 { code: invalid_body }   · 413 { code: too_large } (2 KB)
 *   403 { code: cross_origin }   the request was not made by a page of this host
 *   429 { code: rate_limited }   600 per ten minutes per site and IP
 *   404 { code: site_not_found } the builder host, a template, a host of no site
 */
export async function POST(request: NextRequest) {
  let site: Site | null;
  try {
    const siteId = await siteIdForHost(request.headers.get('x-forwarded-host') || request.headers.get('host'));
    site = siteId ? await getSite(siteId) : null;
  } catch (error) {
    console.error(`[${ROUTE}] the site of the request could not be read; the view is not counted`, error);
    return done();
  }
  if (!site || site.is_template) return refused(404, 'Not found', 'site_not_found');

  if (!isSameOriginRequest(request.headers)) return refused(403, 'A view is sent by a page of the site', 'cross_origin');

  if (Number(request.headers.get('content-length') ?? 0) > MAX_VISIT_BYTES) return refused(413, 'The body is too large', 'too_large');
  const raw = await request.text();
  if (Buffer.byteLength(raw, 'utf8') > MAX_VISIT_BYTES) return refused(413, 'The body is too large', 'too_large');

  const ip = getClientIp(request.headers);
  if (ip && !visitCounter().allow(`${site.id}|${ip}`, Date.now())) {
    return refused(429, 'Too many views. Please try again later.', 'rate_limited');
  }

  const report = parseReport(raw);
  if (!report) return refused(400, 'The body must be { page_id, path, referrer } or { kind: "add_to_cart" }', 'invalid_body');

  if (report.kind === 'add_to_cart') {
    await countEvent(request, site.id, 'add_to_cart', ROUTE);
    return done();
  }

  const visitor = await visitorOf(request, site.id, ROUTE);
  if (!visitor) return done();
  try {
    await recordView({
      siteId: site.id,
      pageId: report.view.pageId,
      path: report.view.path,
      at: visitor.at,
      visitorKey: visitor.key,
      origin: sourceOf(report.view.referrerHost, site.hosts),
      device: visitor.device,
    });
  } catch (error) {
    // The count never fails a page (PRD "Visit counting"): the view is lost, the reason is in the log.
    console.error(`[${ROUTE}] site ${site.id}: the view was not stored`, error);
  }
  return done();
}
