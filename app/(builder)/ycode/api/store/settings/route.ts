import type { NextRequest } from 'next/server';
import { noCache } from '@/lib/api-response';
import { sellingSite, storeFailure, storeNotFound } from '@/lib/platform/store-api';

export const dynamic = 'force-dynamic';

/**
 * GET /ycode/api/store/settings (part 2, session W2): the public part of a
 * site's store, for the cart and checkout elements. Nothing of the branch or
 * the categories.
 *
 *   → { data: { selling: true, currency: 'IQD' | 'USD', delivery_fee: "2500.00" } }
 *
 * A store that does not sell answers 404 { code: store_not_found }, as on the
 * builder host. Anonymous, on the site's own host only.
 */
export async function GET(request: NextRequest) {
  try {
    const selling = await sellingSite(request);
    if (!selling) return storeNotFound();
    const { currency, delivery_fee } = selling.store;
    return noCache({ data: { selling: true, currency, delivery_fee } });
  } catch (error) {
    return storeFailure(error, 'GET /ycode/api/store/settings');
  }
}
