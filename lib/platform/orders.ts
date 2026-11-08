/**
 * The organization's storefront orders for the app (part 2, session W8; PRD
 * V1.1 "Orders"): list, read, count, confirm and cancel.
 *
 * The order is Sales's and the buyer Contact Center's; Web Studio shows both
 * and keeps neither. What it adds is the site: Sales stores the Web Studio site
 * id as the order's sourceReference, and platform_storefront_orders (session
 * W3) names the checkout that made the order. A row is read in four steps:
 *
 *   1. Sales: GET /internal/orders?source=storefront (paged, filtered by status
 *      and by sourceReference = a site id);
 *   2. platform_storefront_orders joined with platform_sites: the site and its
 *      name, and the checkout id. An order with no record (a checkout whose
 *      record was never written; the buyer's retry writes it) is placed by its
 *      sourceReference, which is the same site id;
 *   3. Contact Center: the buyer's name and phone, by the order's customer id,
 *      in chunks of 100;
 *   4. the search (`q`), on the page just read.
 *
 * Contact Center being out of reach does not hide the orders: the rows come
 * back with no buyer name or phone and the answer says why (`buyer_error`),
 * as Store settings does for a service it cannot ask (OPEN_QUESTIONS 12).
 * Sales being out of reach is an error: there is nothing to list.
 *
 * Confirm and cancel (the routes call changeOrderStatus in lib/platform/sales.ts)
 * go to Sales's service status route with the session's user as the acting
 * user. Sales checks that user's own x flag on sales.manage_orders and names
 * them in the order's history; Web Studio does not repeat the check from the
 * sign-in snapshot, which a change of the user's profile since would make wrong
 * in both directions.
 */

import { getKnexClient } from '@/lib/knex-client';
import { ContactCenterUnavailableError, lookupContacts, type DirectoryContact } from '@/lib/platform/contact-center';
import { buyerOf, matchesQuery, orderDetailView, orderLinks, orderRow, UUID_PATTERN, type OrdersQuery, type SiteRef } from '@/lib/platform/orders-view';
import { getStorefrontOrder, listStorefrontOrders } from '@/lib/platform/sales';

/** Why the buyers' names are missing, when they are. */
export type BuyerError = 'contact_center_unavailable' | null;

interface Placement {
  site: SiteRef | null;
  checkoutId: string | null;
}

/** Where each order came from: the site (with its name) and the checkout, for orders of this organization. */
async function placements(organizationId: string, orders: Array<{ id: string; sourceReference: string | null }>): Promise<Map<string, Placement>> {
  const result = new Map<string, Placement>();
  if (orders.length === 0) return result;
  const knex = await getKnexClient();

  const recorded = (await knex('platform_storefront_orders as c')
    .join('platform_sites as s', 's.id', 'c.site_id')
    .where('s.organization_id', organizationId)
    .whereIn('c.sales_order_id', orders.map((order) => order.id))
    .select('c.sales_order_id', 'c.site_id', 'c.checkout_id', 's.name as site_name')) as Array<{ sales_order_id: string; site_id: string; checkout_id: string; site_name: string }>;
  for (const row of recorded) result.set(row.sales_order_id, { site: { id: row.site_id, name: row.site_name }, checkoutId: row.checkout_id });

  // No record: the site is the order's sourceReference, if it is one of this organization's sites (deleted ones included: their orders stay).
  const unplaced = orders.filter((order) => !result.has(order.id));
  const references = Array.from(new Set(unplaced.map((order) => order.sourceReference).filter((ref): ref is string => !!ref && UUID_PATTERN.test(ref)).map((ref) => ref.toLowerCase())));
  const names = new Map<string, string>();
  if (references.length > 0) {
    const sites = (await knex('platform_sites').where({ organization_id: organizationId }).whereIn('id', references).select('id', 'name')) as Array<{ id: string; name: string }>;
    for (const site of sites) names.set(site.id, site.name);
  }
  for (const order of unplaced) {
    const reference = order.sourceReference?.toLowerCase() ?? null;
    result.set(order.id, { site: reference ? { id: reference, name: names.get(reference) ?? null } : null, checkoutId: null });
  }
  return result;
}

/** The buyers of the orders; null (with the reason) when Contact Center cannot be asked. */
async function buyers(organizationId: string, customerIds: string[]): Promise<{ contacts: Map<string, DirectoryContact> | null; error: BuyerError }> {
  try {
    return { contacts: await lookupContacts(organizationId, customerIds), error: null };
  } catch (error) {
    if (!(error instanceof ContactCenterUnavailableError)) throw error;
    console.error(`[orders] the buyers of organization ${organizationId} could not be read: ${error.message}`);
    return { contacts: null, error: 'contact_center_unavailable' };
  }
}

/** One page of the organization's storefront orders; `total` counts the orders matching the site and status across all pages (not `q`). */
export async function listOrders(organizationId: string, query: OrdersQuery) {
  const page = await listStorefrontOrders(organizationId, { status: query.status, siteId: query.siteId, cursor: query.cursor, limit: query.limit });
  const [where, who] = await Promise.all([placements(organizationId, page.orders), buyers(organizationId, page.orders.map((order) => order.customerId))]);
  const rows = page.orders.map((order) => orderRow(order, where.get(order.id)?.site ?? null, buyerOf(order.customerId, who.contacts)));
  return {
    rows: query.q ? rows.filter((row) => matchesQuery(row, query.q!)) : rows,
    nextCursor: page.nextCursor,
    total: page.total,
    buyerError: who.error,
  };
}

/** The storefront orders waiting for confirmation: the drafts. Sales counts them (`total` of the first page of one). */
export async function waitingCount(organizationId: string): Promise<number> {
  return (await listStorefrontOrders(organizationId, { status: ['draft'], limit: 1 })).total;
}

let warnedAboutLinks = false;

/** One storefront order with its buyer, site, lines and history; null when the organization has no such storefront order. */
export async function orderDetail(organizationId: string, orderId: string) {
  const order = await getStorefrontOrder(organizationId, orderId);
  if (!order) return null;
  const [where, who] = await Promise.all([placements(organizationId, [order]), buyers(organizationId, [order.customerId])]);
  const placement = where.get(order.id) ?? { site: null, checkoutId: null };
  const links = orderLinks(order.id);
  if ((!links.open_in_sales || !links.open_in_web_studio) && !warnedAboutLinks) {
    warnedAboutLinks = true;
    console.warn('[orders] SALES_APP_ID or WS_APP_ID is not set: the order\'s deep links to that app are null, so the app cannot offer them');
  }
  return {
    detail: orderDetailView(order, { site: placement.site, checkoutId: placement.checkoutId, buyer: buyerOf(order.customerId, who.contacts), links }),
    buyerError: who.error,
  };
}
