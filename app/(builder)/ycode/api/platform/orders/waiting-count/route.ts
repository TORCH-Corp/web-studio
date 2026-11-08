import { noCache } from '@/lib/api-response';
import { waitingCount } from '@/lib/platform/orders';
import { ordersFailure } from '@/lib/platform/orders-response';
import { getSessionFromCookies } from '@/lib/platform/site';

/**
 * The number of the organization's storefront orders waiting for confirmation,
 * the drafts, for the Navigator's count (part 2, session W8). `webstudio.manage_orders`
 * r is the proxy's check. Sales counts them.
 *
 *   GET → { data: { count } } · 503 { code: 'sales_unavailable' }
 */
export async function GET() {
  const session = await getSessionFromCookies();
  if (!session) return noCache({ error: 'Not authenticated' }, 401);

  try {
    return noCache({ data: { count: await waitingCount(session.org) } });
  } catch (error) {
    return ordersFailure('GET /ycode/api/platform/orders/waiting-count', error, 'Failed to count the orders');
  }
}
