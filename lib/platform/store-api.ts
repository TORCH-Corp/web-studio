/**
 * What the anonymous store routes share (part 2, session W2): which site a
 * request is for, whether it sells, and the answers when it does not or a
 * service cannot be asked.
 *
 * The site comes from the request's host alone (`x-forwarded-host`, then
 * `host`, as nginx forwards them), never from the builder's `ws_site` cookie:
 * resolveSiteId reads that cookie first, which would serve a store on the
 * builder host to anyone who has a site open there. The builder host names no
 * site, so every store route answers 404 on it (PRD V1.1 "Roles and
 * permissions": buyer-facing routes are anonymous on the published host only).
 * A site whose store does not sell answers 404 on every store route: the store
 * elements then render nothing (PRD "Store settings").
 */

import type { NextRequest } from 'next/server';
import { noCache } from '@/lib/api-response';
import { OrgSetupUnavailableError } from '@/lib/platform/org-setup';
import { ProductServicesUnavailableError } from '@/lib/platform/product-services';
import { getSite, siteIdForHost, type Site } from '@/lib/platform/site';
import { StoreMediaUnavailableError } from '@/lib/platform/store-media';
import { storeOf } from '@/lib/platform/store-settings';
import type { StoreRow } from '@/lib/platform/store-settings-input';

/** The site a published host names, when its store sells; null on the builder host, an unknown host, or a store that does not sell. */
export async function sellingSite(request: NextRequest): Promise<{ site: Site; store: StoreRow } | null> {
  const siteId = await siteIdForHost(request.headers.get('x-forwarded-host') || request.headers.get('host'));
  if (!siteId) return null;
  const site = await getSite(siteId);
  if (!site || site.is_template) return null;
  const store = await storeOf(site.id);
  return store.selling ? { site, store } : null;
}

/** No store here: the builder host, a host of no site, or a store that does not sell. */
export const storeNotFound = () => noCache({ error: 'Not found', code: 'store_not_found' }, 404);

export type StoreUnavailableCode = 'product_services_unavailable' | 'org_setup_unavailable' | 'document_center_unavailable';

function unavailableCode(error: unknown): StoreUnavailableCode | null {
  if (error instanceof ProductServicesUnavailableError) return 'product_services_unavailable';
  if (error instanceof OrgSetupUnavailableError) return 'org_setup_unavailable';
  if (error instanceof StoreMediaUnavailableError) return 'document_center_unavailable';
  return null;
}

/**
 * The answer to a failure: 503 with a stable code when a platform service
 * cannot be asked (the elements show the designed error state), 500 for
 * anything else. Both are logged.
 */
export function storeFailure(error: unknown, route: string): Response {
  const code = unavailableCode(error);
  if (code) {
    console.error(`[${route}] ${(error as Error).message}`);
    return noCache({ error: 'The store cannot be read right now', code }, 503);
  }
  console.error(`[${route}]`, error);
  return noCache({ error: 'Failed to read the store' }, 500);
}
