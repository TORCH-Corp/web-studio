import type { NextRequest } from 'next/server';
import { noCache } from '@/lib/api-response';
import { screenFormSubmission, stripHoneypotField } from '@/lib/form-spam-protection';
import { getClientIp } from '@/lib/request-utils';
import { placeOrder, RATE_LIMIT_WINDOW_MS, storedCheckout } from '@/lib/platform/checkout';
import { checkoutIdOf, parseCheckout } from '@/lib/platform/checkout-input';
import { checkoutCounter, limitKey } from '@/lib/platform/checkout-limit';
import { sellingSite, storeNotFound } from '@/lib/platform/store-api';
import { countEvent } from '@/lib/platform/visit-events';

export const dynamic = 'force-dynamic';

/** What the screen's refusals are called, for the page. */
const SCREEN_CODES: Record<number, string> = { 400: 'too_large', 403: 'cross_origin', 429: 'rate_limited' };

const ROUTE = 'POST /ycode/api/store/checkout';

/**
 * POST /ycode/api/store/checkout (part 2, session W3): the buyer's checkout
 * becomes one Contact Center person and one Sales order, once
 * (lib/platform/checkout.ts). Anonymous, on the site's own host only, while its
 * store sells.
 *
 *   { checkout_id: uuid (made once per cart by the page, kept until success),
 *     buyer: { name, phone, city (a code of lib/platform/iraq-governorates.ts),
 *              address, landmark?, notes? },
 *     lines: [{ item_id, quantity }], locale: 'ar' | 'en', ycode_hp? }
 *
 * Screened as the form route is (screenFormSubmission: same origin, size caps,
 * honeypot, rate limit with the site's settings), the limit counting the
 * site's checkouts from the IP that reached Contact Center.
 *
 *   201 { data: { checkout_id, code } }   the order was made (code: SO-…)
 *   200 { data: { checkout_id, code } }   the checkout already had its order
 *   201 { data: { checkout_id, code: null } }  the honeypot was filled: nothing is called or stored
 *   400 { code: invalid_checkout, fields: { 'buyer.phone': '…', … } }  in the page's language
 *   400 { code: invalid_body | too_large } · 403 { code: cross_origin } · 429 { code: rate_limited }
 *   422 { code: item_unavailable, items: [{ item_id, name, reason }] }  reason: inactive,
 *       no_price, no_rate, parent or not_on_sale; nothing was created
 *   503 { code: service_unavailable }  Contact Center, Sales, Product & Services or
 *       Organization Setup could not be asked, or the store cannot take orders now
 *       (no rate on a USD store; Sales refused its branch): nothing is stored
 *   404 { code: store_not_found }  the builder host, an unknown host, a store that does not sell
 *
 * An order made by this request (not a replay, not a request that waited on
 * another's) also writes one 'order' visit event for the visitor
 * (lib/platform/visit-events.ts, part 3 session W8).
 */
export async function POST(request: NextRequest) {
  try {
    const selling = await sellingSite(request);
    if (!selling) return storeNotFound();
    const { site, store } = selling;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return noCache({ error: 'The body must be JSON', code: 'invalid_body' }, 400);
    }
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return noCache({ error: 'The body must be a JSON object', code: 'invalid_body' }, 400);
    }

    const ip = getClientIp(request.headers);
    const counter = checkoutCounter(RATE_LIMIT_WINDOW_MS);
    const verdict = await screenFormSubmission(request.headers, body as Record<string, unknown>, site.id, async (address, since) =>
      counter.count(limitKey(site.id, address), Date.parse(since)),
    );
    if (verdict.outcome === 'reject') {
      return noCache({ error: verdict.error, code: SCREEN_CODES[verdict.status] ?? 'rejected' }, verdict.status);
    }
    if (verdict.outcome === 'spam') {
      // Answered like a success so a bot does not retry; nothing is called or stored (OPEN_QUESTIONS 31).
      console.warn(`[checkout] site ${site.id}: the honeypot was filled; nothing was created`);
      return noCache({ data: { checkout_id: checkoutIdOf(body), code: null } }, 201);
    }
    const fields = stripHoneypotField(body as Record<string, unknown>);

    // A checkout that already has its order is answered by it, whatever else the body holds.
    const checkoutId = checkoutIdOf(fields);
    if (checkoutId) {
      const stored = await storedCheckout(site.id, checkoutId);
      if (stored) return noCache({ data: { checkout_id: checkoutId, code: stored.sales_order_code } }, 200);
    }

    const parsed = parseCheckout(fields, site.default_locale);
    if (!parsed.ok) {
      if (parsed.kind === 'invalid_body') return noCache({ error: parsed.message, code: 'invalid_body' }, 400);
      return noCache({ error: 'Some fields need correcting', code: 'invalid_checkout', fields: parsed.fields }, 400);
    }

    // One 'order' visit event per Sales order made, for the visitor behind the request that made it (session W8):
    // a checkout that already had its order, a refused item and a Sales that was down are not orders, and a second
    // request waiting on the same checkout adds none. It never fails the order.
    const outcome = await placeOrder(site, store, parsed.value, ip, () => countEvent(request, site.id, 'order', ROUTE));
    switch (outcome.kind) {
      case 'placed':
        return noCache({ data: { checkout_id: parsed.value.checkout_id, code: outcome.code } }, outcome.created ? 201 : 200);
      case 'item_unavailable':
        return noCache({ error: 'An item is no longer available', code: 'item_unavailable', items: outcome.items }, 422);
      case 'service_unavailable':
        return noCache({ error: 'The order cannot be placed right now', code: 'service_unavailable' }, 503);
    }
  } catch (error) {
    console.error('[POST /ycode/api/store/checkout]', error);
    return noCache({ error: 'Failed to place the order' }, 500);
  }
}
