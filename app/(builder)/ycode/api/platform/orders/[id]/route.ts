import { NextRequest } from 'next/server';
import { noCache } from '@/lib/api-response';
import { orderDetail } from '@/lib/platform/orders';
import { ordersFailure } from '@/lib/platform/orders-response';
import { UUID_PATTERN } from '@/lib/platform/orders-view';
import { getSessionFromCookies } from '@/lib/platform/site';

/**
 * One storefront order of the organization (part 2, session W8; PRD V1.1
 * "Orders"). `webstudio.manage_orders` r is the proxy's check; the logic is
 * lib/platform/orders.ts. The id is the Sales order's.
 *
 *   GET → { data: { id, code, status, currency, site: { id, name } | null, checkout_id | null,
 *                   buyer: { id, name, phone },
 *                   lines: [{ item_id, sku, name: { en, ar }, axes: [{ specification, option }], unit, quantity, unit_price, line_total }],
 *                   subtotal, delivery_fee, total, payment_method, delivery_address: { city, address, landmark, phone } | null, notes,
 *                   history: [{ from_status, to_status, reason, changed_by: { id, kind, name } | null, changed_at }],
 *                   created_at, updated_at,
 *                   links: { open_in_sales, open_in_web_studio } }, buyer_error }
 *   history is Sales's status history with the actors, oldest first; it is empty until Sales's service read sends it
 *   (OPEN_QUESTIONS). links are torch://app/<catalogue id>/orders/<id>, null without SALES_APP_ID or WS_APP_ID.
 *
 * 404 no such storefront order in the organization · 503 { code: 'sales_unavailable' }.
 */
export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await getSessionFromCookies();
  if (!session) return noCache({ error: 'Not authenticated' }, 401);

  const { id } = await context.params;
  if (!UUID_PATTERN.test(id)) return noCache({ error: 'Order not found' }, 404);

  try {
    const order = await orderDetail(session.org, id.toLowerCase());
    if (!order) return noCache({ error: 'Order not found' }, 404);
    return noCache({ data: order.detail, buyer_error: order.buyerError });
  } catch (error) {
    return ordersFailure('GET /ycode/api/platform/orders/{id}', error, 'Failed to read the order');
  }
}
