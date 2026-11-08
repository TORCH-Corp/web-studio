import { NextRequest } from 'next/server';
import { noCache } from '@/lib/api-response';
import { listOrders } from '@/lib/platform/orders';
import { ordersFailure } from '@/lib/platform/orders-response';
import { parseOrdersQuery } from '@/lib/platform/orders-view';
import { getSessionFromCookies } from '@/lib/platform/site';

/**
 * The organization's storefront orders across its sites (part 2, session W8;
 * PRD V1.1 "Orders"). `webstudio.manage_orders` r is the proxy's check
 * (lib/platform/permissions.ts); the logic is lib/platform/orders.ts.
 *
 *   GET ?site_id=&status=&q=&cursor=&limit=
 *     site_id  only this site's orders
 *     status   draft, confirmed, delivered, finished or cancelled; repeated or comma-separated
 *     q        the order's code or the buyer's name, matched on the page just fetched
 *              (a page can come back with fewer rows than `limit`, or none, and still have a next_cursor)
 *     cursor   next_cursor of the page before; limit 1 to 100, 25 by default
 *   → { data: [{ id, code, site: { id, name } | null, buyer: { id, name, phone }, total, currency, status, created_at }],
 *       next_cursor, total, buyer_error }
 *     total counts the orders matching site_id and status across all pages (not q). A buyer's name and phone are
 *     null when Contact Center does not have the contact or could not be asked; buyer_error then says
 *     'contact_center_unavailable'. A site's name is null for a site that is not the organization's.
 *
 * 400 an invalid query, or { code: 'invalid_cursor' } · 503 { code: 'sales_unavailable' }.
 */
export async function GET(request: NextRequest) {
  const session = await getSessionFromCookies();
  if (!session) return noCache({ error: 'Not authenticated' }, 401);

  const parsed = parseOrdersQuery(request.nextUrl.searchParams);
  if (!parsed.query) return noCache({ error: 'Invalid query', details: parsed.errors }, 400);

  try {
    const page = await listOrders(session.org, parsed.query);
    return noCache({ data: page.rows, next_cursor: page.nextCursor, total: page.total, buyer_error: page.buyerError });
  } catch (error) {
    return ordersFailure('GET /ycode/api/platform/orders', error, 'Failed to read the orders');
  }
}
