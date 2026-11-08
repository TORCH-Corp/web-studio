/**
 * What the Orders API takes and what it answers (part 2, session W8; PRD V1.1
 * "Orders"): the list query, the cancel body, a row of the list, the order's
 * detail and its deep links. Pure: no service is asked here
 * (lib/platform/orders.ts does that), and nothing imports Next, so it runs
 * under `node --test`.
 *
 * Sales owns the order and Contact Center the buyer; Web Studio shows both and
 * keeps neither (PRD V1.1 "Platform"). The answers use the fork's own snake_case.
 */

import { z } from 'zod';
import { ORDER_STATUSES, type OrderActor, type OrderHistoryEntry, type OrderStatus, type OrderSummary, type StorefrontOrder } from './sales';
import type { DirectoryContact } from './contact-center';

export const ORDERS_DEFAULT_LIMIT = 25;
export const ORDERS_MAX_LIMIT = 100;
/** The longest search text or cancel reason. Sales takes a reason of 500 characters (ReasonSchema). */
const MAX_SEARCH = 100;
const MAX_REASON = 500;
const MAX_CURSOR = 1000;

export interface OrdersQuery {
  /** Only the orders of this site. */
  siteId?: string;
  status?: OrderStatus[];
  /** Matched on the fetched page: the order's code or the buyer's name. */
  q?: string;
  cursor?: string;
  limit: number;
}

const QUERY_KEYS = new Set(['site_id', 'status', 'q', 'cursor', 'limit']);
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The query of GET /ycode/api/platform/orders; the messages are ready to return in a 400. */
export function parseOrdersQuery(params: URLSearchParams): { query: OrdersQuery; errors: null } | { query: null; errors: string[] } {
  const errors: string[] = [];
  for (const key of new Set(params.keys())) if (!QUERY_KEYS.has(key)) errors.push(`${key}: is not a parameter of this route`);

  const query: OrdersQuery = { limit: ORDERS_DEFAULT_LIMIT };

  const site = params.get('site_id')?.trim();
  if (site) {
    if (UUID_PATTERN.test(site)) query.siteId = site.toLowerCase();
    else errors.push('site_id: must be a uuid');
  }

  const statuses = params.getAll('status').flatMap((value) => value.split(',')).map((value) => value.trim()).filter(Boolean);
  const unknown = statuses.filter((status) => !(ORDER_STATUSES as readonly string[]).includes(status));
  if (unknown.length > 0) errors.push(`status: ${unknown.join(', ')} ${unknown.length === 1 ? 'is' : 'are'} not of ${ORDER_STATUSES.join(', ')}`);
  else if (statuses.length > 0) query.status = Array.from(new Set(statuses)) as OrderStatus[];

  const text = params.get('q')?.trim();
  if (text) {
    if (text.length <= MAX_SEARCH) query.q = text;
    else errors.push(`q: at most ${MAX_SEARCH} characters`);
  }

  const cursor = params.get('cursor');
  if (cursor) {
    if (cursor.length <= MAX_CURSOR) query.cursor = cursor;
    else errors.push(`cursor: at most ${MAX_CURSOR} characters`);
  }

  const limit = params.get('limit');
  if (limit !== null) {
    const value = /^\d+$/.test(limit) ? Number(limit) : NaN;
    if (Number.isInteger(value) && value >= 1 && value <= ORDERS_MAX_LIMIT) query.limit = value;
    else errors.push(`limit: a whole number from 1 to ${ORDERS_MAX_LIMIT}`);
  }

  return errors.length > 0 ? { query: null, errors } : { query, errors: null };
}

const cancelBodySchema = z.object({ reason: z.string().trim().min(1, 'reason is required').max(MAX_REASON, `reason: at most ${MAX_REASON} characters`) }).strict();

/** The body of a cancel: the reason Sales shows everyone, trimmed. */
export function parseCancelBody(body: unknown): { reason: string; errors: null } | { reason: null; errors: string[] } {
  const result = cancelBodySchema.safeParse(body);
  if (result.success) return { reason: result.data.reason, errors: null };
  return { reason: null, errors: result.error.issues.map((issue) => (issue.path.length ? `${issue.path.join('.')}: ${issue.message}` : issue.message)) };
}

export interface SiteRef {
  id: string;
  /** Null when the site is not one of the organization's sites any more. */
  name: string | null;
}

export interface BuyerView {
  id: string;
  /** Null when Contact Center does not have the contact, or could not be asked. */
  name: string | null;
  phone: string | null;
}

/** The buyer of an order; `contacts` is null when Contact Center could not be asked. */
export function buyerOf(customerId: string, contacts: Map<string, DirectoryContact> | null): BuyerView {
  const contact = contacts?.get(customerId);
  return { id: customerId, name: contact?.name ?? null, phone: contact?.phone ?? null };
}

export interface OrderRowView {
  id: string;
  code: string;
  site: SiteRef | null;
  buyer: BuyerView;
  total: string;
  currency: 'IQD' | 'USD';
  status: OrderStatus;
  created_at: string;
}

export function orderRow(order: OrderSummary, site: SiteRef | null, buyer: BuyerView): OrderRowView {
  return { id: order.id, code: order.code, site, buyer, total: order.total, currency: order.currency, status: order.status, created_at: order.createdAt };
}

/** The list's search: the text is in the order's code or the buyer's name, in any case. */
export function matchesQuery(row: OrderRowView, text: string): boolean {
  const needle = text.trim().toLowerCase();
  return row.code.toLowerCase().includes(needle) || (row.buyer.name?.toLowerCase().includes(needle) ?? false);
}

export interface OrderLinks {
  /** The order in the Sales app, as Sales's own notification opens it. Null without SALES_APP_ID. */
  open_in_sales: string | null;
  /** The order in Web Studio's Orders. Null without WS_APP_ID. */
  open_in_web_studio: string | null;
}

/**
 * `torch://app/<catalogue uuid>/orders/<order id>`: the shell opens the app by its
 * catalogue id and hands the rest to it (sales-service docs/deep-links.md).
 */
export function orderLinks(orderId: string, env: Record<string, string | undefined> = process.env): OrderLinks {
  const link = (appId: string | undefined) => (appId?.trim() ? `torch://app/${appId.trim()}/orders/${orderId}` : null);
  return { open_in_sales: link(env.SALES_APP_ID), open_in_web_studio: link(env.WS_APP_ID) };
}

function historyView(entry: OrderHistoryEntry) {
  const actor = (by: OrderActor | null) => (by ? { id: by.id, kind: by.kind, name: by.name } : null);
  return { from_status: entry.fromStatus, to_status: entry.toStatus, reason: entry.reason, changed_by: actor(entry.changedBy), changed_at: entry.changedAt };
}

export function orderDetailView(
  order: StorefrontOrder,
  context: { site: SiteRef | null; checkoutId: string | null; buyer: BuyerView; links: OrderLinks },
) {
  return {
    id: order.id,
    code: order.code,
    status: order.status,
    currency: order.currency,
    site: context.site,
    checkout_id: context.checkoutId,
    buyer: context.buyer,
    lines: order.lines.map((line) => ({
      item_id: line.itemId,
      sku: line.sku,
      name: line.name,
      axes: line.axes,
      unit: line.unit,
      quantity: line.quantity,
      unit_price: line.unitPrice,
      line_total: line.lineTotal,
    })),
    subtotal: order.subtotal,
    delivery_fee: order.deliveryFee,
    total: order.total,
    payment_method: order.paymentMethod,
    delivery_address: order.deliveryAddress,
    notes: order.notes,
    history: order.history.map(historyView),
    created_at: order.createdAt,
    updated_at: order.updatedAt,
    links: context.links,
  };
}
