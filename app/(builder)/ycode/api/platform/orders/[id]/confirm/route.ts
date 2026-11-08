import { NextRequest } from 'next/server';
import { noCache } from '@/lib/api-response';
import { ordersFailure } from '@/lib/platform/orders-response';
import { UUID_PATTERN } from '@/lib/platform/orders-view';
import { changeOrderStatus } from '@/lib/platform/sales';
import { getSessionFromCookies } from '@/lib/platform/site';

/**
 * Confirm a storefront order on behalf of the signed-in user (part 2, session
 * W8; PRD V1.1 "Orders"). `webstudio.manage_orders` x is the proxy's check
 * (403 naming the flag). Sales's service status route does the rest: it checks
 * the user's own x flag on sales.manage_orders, moves the order from draft to
 * confirmed and names the user in the history. Delivered and finished are set
 * in Sales only.
 *
 *   POST (no body) → { data: { id, status: 'confirmed' } }; read the order again for its history
 *
 * 403 { code: 'sales_permission_missing', required: 'sales.manage_orders.x' } the user lacks Sales's flag ·
 * 404 no such storefront order · 409/422 { code } a rule of the order (an invoiced order, a status it cannot move to) ·
 * 503 { code: 'sales_unavailable' }.
 */
export async function POST(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await getSessionFromCookies();
  if (!session) return noCache({ error: 'Not authenticated' }, 401);

  const { id } = await context.params;
  if (!UUID_PATTERN.test(id)) return noCache({ error: 'Order not found' }, 404);

  try {
    const outcome = await changeOrderStatus(session.org, id.toLowerCase(), session.sub, { status: 'confirmed' });
    if (outcome === 'not_found') return noCache({ error: 'Order not found' }, 404);
    return noCache({ data: { id: id.toLowerCase(), status: 'confirmed' } });
  } catch (error) {
    return ordersFailure('POST /ycode/api/platform/orders/{id}/confirm', error, 'Failed to confirm the order');
  }
}
