import { NextRequest } from 'next/server';
import { noCache } from '@/lib/api-response';
import { getSessionFromCookies, getSiteForOrganization } from '@/lib/platform/site';
import { parseStorePatch } from '@/lib/platform/store-settings-input';
import { applyStoreSettings, readStoreSettings, storeErrorStatus, StoreSettingsError } from '@/lib/platform/store-settings';

/**
 * Store settings (part 2, session W1; PRD V1.1 "Store settings"): what the
 * Tauri app's Store settings screen shows and saves, for one site of the
 * session's organization. A site of another organization is not found. The
 * permission checks are the proxy's (lib/platform/permissions.ts):
 * manage_sites r for GET, u for PATCH. The logic is lib/platform/store-settings.ts.
 *
 *   GET   → { data: { selling, currency,
 *                     branch: { id, name, available } | null,
 *                     branches: [{ id, name }] | null, branches_error,
 *                     categories: [{ id, name, name_ar, item_count, available }],
 *                     category_tree: [{ id, name, name_ar, item_count, children }] | null, category_tree_error,
 *                     delivery_fee: "0.00", payment_methods: ['cash_on_delivery'] } }
 *           A service that cannot be asked leaves its list null and says why in *_error.
 *   PATCH → the same document afterwards. The body names what changes:
 *           selling, currency, branch_id (null clears it), category_ids (the
 *           whole set; empty sells every eligible item), delivery_fee (a number
 *           or a decimal string, two decimals at most). Unknown keys are 400.
 *
 * 400 invalid body · 403 a template's store · 404 no such site ·
 * 422 { code }: branch_required (selling without a branch), fee_required (a
 * currency change without the fee), branch_unavailable, categories_unavailable ·
 * 503 { code }: org_setup_unavailable, product_services_unavailable (a change
 * that needs the service's check while it cannot be asked).
 */
export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await getSessionFromCookies();
  if (!session) return noCache({ error: 'Not authenticated' }, 401);

  const { id } = await context.params;
  const site = await getSiteForOrganization(id, session.org);
  if (!site) return noCache({ error: 'Site not found' }, 404);

  try {
    return noCache({ data: await readStoreSettings(site) });
  } catch (error) {
    console.error('[GET /ycode/api/platform/sites/{id}/store]', error);
    return noCache({ error: 'Failed to read the store settings' }, 500);
  }
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await getSessionFromCookies();
  if (!session) return noCache({ error: 'Not authenticated' }, 401);

  const { id } = await context.params;
  const site = await getSiteForOrganization(id, session.org);
  if (!site) return noCache({ error: 'Site not found' }, 404);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return noCache({ error: 'The body must be JSON' }, 400);
  }
  const { patch, errors } = parseStorePatch(body);
  if (!patch) return noCache({ error: 'Invalid store settings', details: errors }, 400);

  try {
    return noCache({ data: await applyStoreSettings(site, patch, { id: session.sub }) });
  } catch (error) {
    if (error instanceof StoreSettingsError) {
      return noCache({ error: error.message, code: error.kind, ...error.details }, storeErrorStatus(error.kind));
    }
    console.error('[PATCH /ycode/api/platform/sites/{id}/store]', error);
    return noCache({ error: 'Failed to save the store settings' }, 500);
  }
}
