import { NextResponse, type NextRequest } from 'next/server';
import { noCache } from '@/lib/api-response';
import { getClientIp, isSameOriginRequest } from '@/lib/request-utils';
import { SESSION_COOKIE, verifySession } from '@/lib/platform/session';
import { getSite, siteIdForHost, type Site } from '@/lib/platform/site';
import { visitCounter } from '@/lib/platform/visit-limit';
import { MAX_VISIT_BYTES, deviceOf, isBot, isPrefetch, parseVisit, sourceOf, visitDay, visitSalt, visitorKey } from '@/lib/platform/visit-rules';
import { recordView } from '@/lib/platform/visits';

export const dynamic = 'force-dynamic';

const ROUTE = 'POST /ycode/api/visits';

/** The answer to a view, counted or not: nothing to read, never kept. */
const done = () => new NextResponse(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });

const refused = (status: number, error: string, code: string) => noCache({ error, code }, status);

const globalForVisits = globalThis as unknown as { __webStudioVisitSaltReported?: boolean };

/** Say once per process that views cannot be counted without the salt. */
function reportMissingSalt(): void {
  if (globalForVisits.__webStudioVisitSaltReported) return;
  globalForVisits.__webStudioVisitSaltReported = true;
  console.error(`[${ROUTE}] WS_VISIT_SALT is not set (or is shorter than 16 characters): no view is counted until it is`);
}

/**
 * POST /ycode/api/visits (part 3, session W7; a published page calls it as
 * `/studio/api/visits`): one view of a published page, sent by the page itself
 * once it is on the visitor's screen (lib/platform/VisitBeacon.tsx).
 * Anonymous, on the site's own host only.
 *
 *   { page_id: uuid, path: '/about', referrer: 'www.google.com' | '' }
 *
 * `referrer` is the host of the page's referrer and is used for the source
 * only. The IP address and the user agent are read for the visitor key of the
 * day and the device type; none of the three is stored or logged
 * (lib/platform/visit-rules.ts).
 *
 *   204  the view was read. It is stored unless it came from a known bot, a
 *        prefetch, a signed-in Business OS user (an editor looking at his own
 *        site where his session reaches), a page that is not a published page
 *        of this site, or the count failed (logged; the page never knows)
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

  const visit = parseVisit(raw);
  if (!visit) return refused(400, 'The body must be { page_id, path, referrer }', 'invalid_body');

  const userAgent = request.headers.get('user-agent') ?? '';
  if (isPrefetch(request.headers) || isBot(userAgent)) return done();
  if (await verifySession(request.cookies.get(SESSION_COOKIE)?.value)) return done();

  // No address to tell one visitor from another (no proxy header): every visitor with the same browser would be one.
  if (!ip) {
    console.error(`[${ROUTE}] site ${site.id}: the request carries no client address (X-Real-IP, X-Forwarded-For); the view is not counted`);
    return done();
  }
  const salt = visitSalt();
  if (!salt) {
    reportMissingSalt();
    return done();
  }

  try {
    const at = new Date();
    await recordView({
      siteId: site.id,
      pageId: visit.pageId,
      path: visit.path,
      at,
      visitorKey: visitorKey({ siteId: site.id, day: visitDay(at), ip, userAgent }, salt),
      origin: sourceOf(visit.referrerHost, site.hosts),
      device: deviceOf(userAgent),
    });
  } catch (error) {
    // The count never fails a page (PRD "Visit counting"): the view is lost, the reason is in the log.
    console.error(`[${ROUTE}] site ${site.id}: the view was not stored`, error);
  }
  return done();
}
