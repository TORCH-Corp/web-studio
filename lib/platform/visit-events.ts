/**
 * The three conversion events of a visitor (part 3, session W8; PRD V1.0
 * "Visit counting": "Add to cart, a placed order and a form submission are
 * counted as events of the same visitor").
 *
 * - 'add_to_cart': the store's add to cart tells its own host
 *   (lib/platform/visit-client.ts, `POST /studio/api/visits` with
 *   `{ kind: 'add_to_cart' }`). One row per visitor and day.
 * - 'order': the checkout route writes it when it creates a Sales order
 *   (not for a replayed checkout, a refused item or a Sales that was down).
 * - 'form': the form route writes it when a submission that is not spam is
 *   stored.
 *
 * Each is counted for the visitor of the request that caused it, and so carries
 * the same visitor key that visitor's page view has that day (same site, same
 * day, same address and browser, same salt) and the source of that visitor's
 * first row of the day. The same rules as a view decide whether it is counted at
 * all: a known bot, a prefetch, a signed-in Business OS session, a request with
 * no client address, and a missing salt count nothing. A failure to count is
 * logged and the visitor's own request, the order or the submission, goes on: the
 * count never fails what the visitor did.
 */

import { getClientIp } from '@/lib/request-utils';
import { SESSION_COOKIE, verifySession } from '@/lib/platform/session';
import { siteIdForHost } from '@/lib/platform/site';
import { deviceOf, isBot, isPrefetch, visitDay, visitSalt, visitorKey, type VisitDevice } from '@/lib/platform/visit-rules';
import { recordEvent, type EventKind } from '@/lib/platform/visits';

/** The parts of a request the visitor is worked out from (a `NextRequest` is one). */
export interface VisitRequest {
  headers: Headers;
  cookies: { get(name: string): { value: string } | undefined };
}

/** A visitor that counts: who they are today, and when. */
export interface CountedVisitor {
  key: string;
  device: VisitDevice;
  at: Date;
}

const globalForEvents = globalThis as unknown as { __webStudioVisitSaltReported?: boolean };

/** Say once per process that nothing can be counted without the salt. */
function reportMissingSalt(route: string): void {
  if (globalForEvents.__webStudioVisitSaltReported) return;
  globalForEvents.__webStudioVisitSaltReported = true;
  console.error(`[${route}] WS_VISIT_SALT is not set (or is shorter than 16 characters): no view or event is counted until it is`);
}

/**
 * The visitor behind a request, or null when the request is not counted (see
 * the top of this file). Reads the address and the browser's name for the key
 * and the device; stores and logs neither.
 */
export async function visitorOf(request: VisitRequest, siteId: string, route: string): Promise<CountedVisitor | null> {
  const userAgent = request.headers.get('user-agent') ?? '';
  if (isPrefetch(request.headers) || isBot(userAgent)) return null;
  if (await verifySession(request.cookies.get(SESSION_COOKIE)?.value)) return null;

  // No address to tell one visitor from another (no proxy header): every visitor with the same browser would be one.
  const ip = getClientIp(request.headers);
  if (!ip) {
    console.error(`[${route}] site ${siteId}: the request carries no client address (X-Real-IP, X-Forwarded-For); it is not counted`);
    return null;
  }
  const salt = visitSalt();
  if (!salt) {
    reportMissingSalt(route);
    return null;
  }

  const at = new Date();
  return { key: visitorKey({ siteId, day: visitDay(at), ip, userAgent }, salt), device: deviceOf(userAgent), at };
}

/**
 * Count an event of the visitor behind `request`, on `siteId`. Never throws: a
 * failure is logged and the caller's work goes on.
 */
export async function countEvent(request: VisitRequest, siteId: string, kind: EventKind, route: string): Promise<void> {
  try {
    const visitor = await visitorOf(request, siteId, route);
    if (!visitor) return;
    await recordEvent({ siteId, kind, at: visitor.at, visitorKey: visitor.key, device: visitor.device });
  } catch (error) {
    console.error(`[${route}] site ${siteId}: the ${kind} event was not stored`, error);
  }
}

/**
 * Count an event on the site the request's host names: a request on the builder
 * host or on a host of no site counts nothing. Never throws.
 */
export async function countEventOnHost(request: VisitRequest, kind: EventKind, route: string): Promise<void> {
  let siteId: string | null;
  try {
    siteId = await siteIdForHost(request.headers.get('x-forwarded-host') || request.headers.get('host'));
  } catch (error) {
    console.error(`[${route}] the site of the request could not be read; the ${kind} event is not counted`, error);
    return;
  }
  if (siteId) await countEvent(request, siteId, kind, route);
}
