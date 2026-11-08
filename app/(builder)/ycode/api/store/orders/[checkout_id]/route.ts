import type { NextRequest } from 'next/server';
import { noCache } from '@/lib/api-response';
import { confirmation } from '@/lib/platform/checkout';
import { checkoutIdOf } from '@/lib/platform/checkout-input';
import { SalesUnavailableError } from '@/lib/platform/sales';
import { sellingSite, storeNotFound } from '@/lib/platform/store-api';

export const dynamic = 'force-dynamic';

/**
 * GET /ycode/api/store/orders/{checkout_id} (part 2, session W3): the
 * confirmation page's read of a checkout's order, from Sales. Anonymous, on
 * the site's own host only: a checkout of another site is not found here.
 *
 *   → { data: { checkout_id, code, currency,
 *               lines: [{ item_id, sku, name, name_ar, axes: [{ name, name_ar, option, option_ar }],
 *                         unit: { code, name }, quantity, unit_price, line_total }],
 *               subtotal, delivery_fee, total, payment_method: 'cash_on_delivery', phone } }
 *
 * Amounts are Sales's decimal strings in the order's currency; `phone` is the
 * number the buyer typed. Nothing else of the buyer is returned.
 *
 * 404 { code: order_not_found }: no such checkout on this site (the page shows
 * the designed not-found) · 404 { code: store_not_found } · 503 { code:
 * service_unavailable }: Sales cannot be asked.
 */
export async function GET(request: NextRequest, context: { params: Promise<{ checkout_id: string }> }) {
  try {
    const selling = await sellingSite(request);
    if (!selling) return storeNotFound();
    const checkoutId = checkoutIdOf({ checkout_id: (await context.params).checkout_id });
    const order = checkoutId ? await confirmation(selling.site, checkoutId) : null;
    if (!order) return noCache({ error: 'No such order', code: 'order_not_found' }, 404);
    return noCache({ data: order });
  } catch (error) {
    if (error instanceof SalesUnavailableError) {
      console.error(`[GET /ycode/api/store/orders/{checkout_id}] ${error.message}`);
      return noCache({ error: 'The order cannot be read right now', code: 'service_unavailable' }, 503);
    }
    console.error('[GET /ycode/api/store/orders/{checkout_id}]', error);
    return noCache({ error: 'Failed to read the order' }, 500);
  }
}
