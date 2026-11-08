import { NextRequest } from 'next/server';
import { noCache } from '@/lib/api-response';
import { parseCancelBody, UUID_PATTERN } from '@/lib/platform/orders-view';
import { ordersFailure } from '@/lib/platform/orders-response';
import { changeOrderStatus } from '@/lib/platform/sales';
import { getSessionFromCookies } from '@/lib/platform/site';

/**
 * Cancel a storefront order, with a reason, on behalf of the signed-in user
 * (part 2, session W8; PRD V1.1 "Orders"). The checks are the confirm route's:
 * `webstudio.manage_orders` x at the proxy, the user's own sales.manage_orders
 * x at Sales, which cancels from draft or confirmed and shows the reason to
 * everyone.
 *
 *   POST { reason }   1 to 500 characters after trimming; nothing else in the body
 *     → { data: { id, status: 'cancelled' } }; read the order again for its history
 *
 * 400 an invalid body · the confirm route's 403, 404, 409, 422 and 503.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await getSessionFromCookies();
  if (!session) return noCache({ error: 'Not authenticated' }, 401);

  const { id } = await context.params;
  if (!UUID_PATTERN.test(id)) return noCache({ error: 'Order not found' }, 404);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return noCache({ error: 'The body must be JSON' }, 400);
  }
  const parsed = parseCancelBody(body);
  if (parsed.reason === null) return noCache({ error: 'Invalid cancellation', details: parsed.errors }, 400);

  try {
    const outcome = await changeOrderStatus(session.org, id.toLowerCase(), session.sub, { status: 'cancelled', reason: parsed.reason });
    if (outcome === 'not_found') return noCache({ error: 'Order not found' }, 404);
    return noCache({ data: { id: id.toLowerCase(), status: 'cancelled' } });
  } catch (error) {
    return ordersFailure('POST /ycode/api/platform/orders/{id}/cancel', error, 'Failed to cancel the order');
  }
}
