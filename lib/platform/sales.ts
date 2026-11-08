/**
 * Sales client: the storefront order (part 2, session W3; PRD V1.1 "Sales",
 * Sales PRD V0.2 "Storefront orders").
 *
 * Two routes of sales-service, both service-to-service: `x-service-api-key`
 * (Sales's SERVICE_API_KEY) and `x-entity-id` (the organization), refused to a
 * user token. Routes sit at the root (no prefix); bodies are
 * `additionalProperties: false`, so an unknown key is 400; amounts and
 * quantities are decimal strings; the envelope is `{ success, data }`.
 *
 *   POST /internal/orders   the service create (session SL2, built after this
 *        client: its contract is the session plan's, amended on 8 Nov 2026):
 *        { source: 'storefront', sourceReference: <site id>, checkoutId,
 *          customer: { kind: 'PERSON', id }, branchId, currency,
 *          lines: [{ itemId, quantity }], deliveryFee, paymentMethod:
 *          'cash_on_delivery', deliveryAddress: { city, address, landmark?,
 *          phone }, notes? }
 *        → 201 { data: { id, code, status, … } } for a new draft order, or 200
 *          with the order already made for this checkoutId (idempotent per
 *          organization and checkoutId, also for two calls at once). Sales
 *          prices every line itself; no price is sent.
 *        → 422 { code, message, items? }: a rule refused it. The item codes
 *          (item_not_found, item_inactive, item_is_parent, item_no_price,
 *          item_currency_mismatch) and no_rate_for_date carry `items`, the ids
 *          they refuse (OPEN_QUESTIONS 29); customer_not_found,
 *          customer_archived and branch_not_found carry none.
 *        → 502 when a service Sales calls is down.
 *   GET  /internal/orders/{id}   the order object (`OrderObjectDetailSchema`),
 *        with SL1's paymentMethod, deliveryFee, deliveryAddress and each line's
 *        axes `[{ specification: { en, ar }, option: { en, ar } }]`; 404 when
 *        the organization has no such order.
 *
 *   GET  /internal/orders?source=storefront[&status=…][&sourceReference=<site id>][&cursor][&limit]
 *        → { success, data: { items: [order object], nextCursor, total } }: total counts the rows matching the
 *          filters across all pages (the Navigator's waiting count is `status=draft&limit=1`'s total).
 *          No date filter and no text search.
 *   POST /internal/orders/{id}/status   (session SL3; part 2 session W8)
 *        { status: 'confirmed' } or { status: 'cancelled', reason }, plus actingUserId (the Web Studio user): Sales
 *        checks that user's x flag on sales.manage_orders and names them in the history. Only storefront orders.
 *        → 200 the order changed · 403 { code: 'permission_missing' } the user lacks the flag, or another code for
 *          a refusal (a non-storefront order) · 404 · 409 { code: 'order_invoiced' } · 422 { code: 'invalid_transition' }.
 *        The answer's body is not read: the Orders API answers with the id and the status it asked for.
 *
 * The order object has a status `history` (fromStatus, toStatus, reason, changedBy { id, kind, name }, changedAt)
 * only if Sales sends one: the service read built in SL1 carries none, the user-token read does. This client takes
 * it when it is there and leaves it empty when it is not (owner, 8 Nov 2026).
 *
 * A 400 means this client sent what Sales does not take: a contract mismatch,
 * thrown as a plain error (the route answers 500 and logs it). Any other
 * failure is SalesUnavailableError (the route answers 503).
 *
 * SALES_URL and SALES_API_KEY come from the environment. Kept free of Next
 * imports so it runs under `node --test`.
 */

import type { StoreCurrency } from '@/lib/platform/store-money';

/** Sales is not configured, cannot be reached, or did not answer as its contract says. */
export class SalesUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SalesUnavailableError';
  }
}

/** Sales refused the order with a 422 (a rule of the order). */
export class SalesRefusedError extends Error {
  constructor(
    readonly code: string,
    readonly items: string[],
    message: string,
  ) {
    super(message);
    this.name = 'SalesRefusedError';
  }
}

/** Sales refused the cursor a list was asked to continue from. */
export class InvalidCursorError extends Error {
  constructor() {
    super('Sales did not accept the cursor');
    this.name = 'InvalidCursorError';
  }
}

/** The acting user does not hold the x flag on sales.manage_orders: Sales answered 403 permission_missing. */
export class SalesPermissionMissingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SalesPermissionMissingError';
  }
}

/** Sales refused the status change by a rule of the order: a 403 for another reason, a 409 or a 422, each with its code. */
export class SalesStatusRefusedError extends Error {
  constructor(
    readonly httpStatus: 403 | 409 | 422,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'SalesStatusRefusedError';
  }
}

type Env = Record<string, string | undefined>;

/** The create calls Contact Center, Product & Services and Organization Setup in turn; a retry of a slow create is answered by the order it made. */
const CREATE_TIMEOUT_MS = 20_000;
const READ_TIMEOUT_MS = 5_000;
/** The status change asks auth-service and writes the history, the change log and the audit log. */
const STATUS_TIMEOUT_MS = 15_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function config(env: Env): { baseUrl: string; apiKey: string } {
  const baseUrl = env.SALES_URL?.trim().replace(/\/+$/, '');
  const apiKey = env.SALES_API_KEY?.trim();
  if (!baseUrl || !apiKey) throw new SalesUnavailableError('SALES_URL and SALES_API_KEY are not set');
  return { baseUrl, apiKey };
}

async function call(
  op: string,
  path: string,
  init: { method: 'GET' | 'POST'; organizationId: string; body?: unknown; timeoutMs: number },
  env: Env,
  fetchImpl: typeof fetch,
): Promise<Response> {
  const { baseUrl, apiKey } = config(env);
  const headers: Record<string, string> = { 'x-service-api-key': apiKey, 'x-entity-id': init.organizationId };
  if (init.body !== undefined) headers['content-type'] = 'application/json';
  try {
    return await fetchImpl(`${baseUrl}${path}`, {
      method: init.method,
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(init.timeoutMs),
    });
  } catch (error) {
    throw new SalesUnavailableError(`Sales is not reachable (${op}): ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function failure(op: string, response: Response): Promise<Error> {
  const detail = (await response.text().catch(() => '')).slice(0, 300);
  const message = `Sales answered ${response.status} to ${op}${detail ? `: ${detail}` : ''}`;
  return response.status === 400 ? new Error(message) : new SalesUnavailableError(message);
}

export interface StorefrontOrderInput {
  /** The Web Studio site: the order's sourceReference, so every order of a site can be listed. */
  siteId: string;
  checkoutId: string;
  /** The Contact Center person of the buyer. */
  personId: string;
  branchId: string;
  currency: StoreCurrency;
  lines: Array<{ itemId: string; quantity: string }>;
  /** The store's fee, a decimal string. */
  deliveryFee: string;
  address: { city: string; address: string; landmark: string | null; phone: string };
  notes: string | null;
}

/** The body of the service create; absent optional values are left out, as Sales's schemas take them. */
export function createOrderBody(input: StorefrontOrderInput): Record<string, unknown> {
  const deliveryAddress: Record<string, string> = { city: input.address.city, address: input.address.address, phone: input.address.phone };
  if (input.address.landmark) deliveryAddress.landmark = input.address.landmark;
  return {
    source: 'storefront',
    sourceReference: input.siteId,
    checkoutId: input.checkoutId,
    customer: { kind: 'PERSON', id: input.personId },
    branchId: input.branchId,
    currency: input.currency,
    lines: input.lines.map((line) => ({ itemId: line.itemId, quantity: line.quantity })),
    deliveryFee: input.deliveryFee,
    paymentMethod: 'cash_on_delivery',
    deliveryAddress,
    ...(input.notes ? { notes: input.notes } : {}),
  };
}

/** The storefront order of this checkout: made now (`created`), or the one Sales already made for it. */
export async function createStorefrontOrder(
  organizationId: string,
  input: StorefrontOrderInput,
  env: Env = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<{ id: string; code: string; created: boolean }> {
  const op = 'POST /internal/orders';
  const response = await call(op, '/internal/orders', { method: 'POST', organizationId, body: createOrderBody(input), timeoutMs: CREATE_TIMEOUT_MS }, env, fetchImpl);
  if (response.status === 422) {
    const body = (await response.json().catch(() => undefined)) as { code?: unknown; message?: unknown; items?: unknown } | undefined;
    if (!body || typeof body.code !== 'string') throw new SalesUnavailableError(`Sales answered 422 to ${op} with no code`);
    const items = Array.isArray(body.items) ? body.items.filter((id): id is string => typeof id === 'string' && UUID.test(id)) : [];
    throw new SalesRefusedError(body.code, items, `Sales refused the order: ${body.code}${typeof body.message === 'string' ? ` (${body.message})` : ''}`);
  }
  if (response.status !== 200 && response.status !== 201) throw await failure(op, response);
  const body = (await response.json().catch(() => undefined)) as { success?: unknown; data?: { id?: unknown; code?: unknown } } | undefined;
  const id = body?.data?.id;
  const code = body?.data?.code;
  if (body?.success !== true || typeof id !== 'string' || !UUID.test(id) || typeof code !== 'string' || !code) {
    throw new SalesUnavailableError(`Sales answered ${op} with an unexpected body`);
  }
  return { id: id.toLowerCase(), code, created: response.status === 201 };
}

/** A line of an order as the confirmation shows it. */
export interface SalesOrderLine {
  itemId: string;
  sku: string;
  name: { en: string; ar: string | null };
  axes: Array<{ specification: { en: string; ar: string | null }; option: { en: string; ar: string | null } }>;
  unit: { code: string; name: string };
  quantity: string;
  unitPrice: string;
  lineTotal: string;
}

/** The fields of a Sales order the confirmation reads. */
export interface SalesOrder {
  id: string;
  code: string;
  currency: StoreCurrency;
  lines: SalesOrderLine[];
  subtotal: string;
  deliveryFee: string;
  total: string;
  paymentMethod: 'cash_on_delivery' | null;
  deliveryAddress: { city: string; address: string; landmark: string | null; phone: string } | null;
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isText = (value: unknown): value is string => typeof value === 'string';
const isTextOrNull = (value: unknown): value is string | null => value === null || typeof value === 'string';
const isNames = (value: unknown): value is { en: string; ar: string | null } => isObject(value) && isText(value.en) && isTextOrNull(value.ar);

function toLine(value: unknown): SalesOrderLine | null {
  if (!isObject(value)) return null;
  const { itemId, sku, name, axes, unit, quantity, unitPrice, lineTotal } = value;
  if (!isText(itemId) || !isText(sku) || !isNames(name) || !Array.isArray(axes) || !isObject(unit) || !isText(unit.code) || !isText(unit.name)) return null;
  if (!isText(quantity) || !isText(unitPrice) || !isText(lineTotal)) return null;
  const parsedAxes = axes.map((axis) => (isObject(axis) && isNames(axis.specification) && isNames(axis.option) ? { specification: axis.specification, option: axis.option } : null));
  if (parsedAxes.some((axis) => axis === null)) return null;
  return {
    itemId,
    sku,
    name: { en: name.en, ar: name.ar },
    axes: parsedAxes as SalesOrderLine['axes'],
    unit: { code: unit.code, name: unit.name },
    quantity,
    unitPrice,
    lineTotal,
  };
}

/** The order as the internal read answers it; null when a field the confirmation needs is missing or of another type. */
export function toSalesOrder(data: unknown): SalesOrder | null {
  if (!isObject(data)) return null;
  const { id, code, currency, lines, subtotal, deliveryFee, total, paymentMethod, deliveryAddress } = data;
  if (!isText(id) || !isText(code) || (currency !== 'IQD' && currency !== 'USD') || !Array.isArray(lines)) return null;
  if (!isText(subtotal) || !isText(deliveryFee) || !isText(total)) return null;
  if (paymentMethod !== null && paymentMethod !== 'cash_on_delivery') return null;
  let address: SalesOrder['deliveryAddress'] = null;
  if (deliveryAddress !== null) {
    if (!isObject(deliveryAddress) || !isText(deliveryAddress.city) || !isText(deliveryAddress.address) || !isText(deliveryAddress.phone)) return null;
    const landmark = deliveryAddress.landmark ?? null;
    if (!isTextOrNull(landmark)) return null;
    address = { city: deliveryAddress.city, address: deliveryAddress.address, landmark, phone: deliveryAddress.phone };
  }
  const parsedLines = lines.map(toLine);
  if (parsedLines.some((line) => line === null)) return null;
  return {
    id,
    code,
    currency,
    lines: parsedLines as SalesOrderLine[],
    subtotal,
    deliveryFee,
    total,
    paymentMethod,
    deliveryAddress: address,
  };
}

/** One order of the organization; null when Sales has none with this id. */
export async function getOrder(organizationId: string, orderId: string, env: Env = process.env, fetchImpl: typeof fetch = fetch): Promise<SalesOrder | null> {
  const op = 'GET /internal/orders/{id}';
  const response = await call(op, `/internal/orders/${encodeURIComponent(orderId)}`, { method: 'GET', organizationId, timeoutMs: READ_TIMEOUT_MS }, env, fetchImpl);
  if (response.status === 404) return null;
  if (!response.ok) throw await failure(op, response);
  const body = (await response.json().catch(() => undefined)) as { success?: unknown; data?: unknown } | undefined;
  const order = body?.success === true ? toSalesOrder(body.data) : null;
  if (!order) throw new SalesUnavailableError(`Sales answered ${op} with an unexpected body`);
  return order;
}

// ---------------------------------------------------------------------------
// The Orders API (part 2, session W8; PRD V1.1 "Orders")
// ---------------------------------------------------------------------------

export const ORDER_STATUSES = ['draft', 'confirmed', 'delivered', 'finished', 'cancelled'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

const isStatus = (value: unknown): value is OrderStatus => typeof value === 'string' && (ORDER_STATUSES as readonly string[]).includes(value);
const isCurrency = (value: unknown): value is StoreCurrency => value === 'IQD' || value === 'USD';

/** What a row of the Orders list needs of a Sales order. */
export interface OrderSummary {
  id: string;
  code: string;
  status: OrderStatus;
  /** The Contact Center person (or organization) the order is for. */
  customerId: string;
  currency: StoreCurrency;
  total: string;
  /** The Web Studio site of a storefront order. */
  sourceReference: string | null;
  createdAt: string;
}

export interface OrderListQuery {
  status?: OrderStatus[];
  /** Only the orders of this site (Sales' exact-match sourceReference). */
  siteId?: string;
  cursor?: string;
  limit?: number;
}

export interface OrderPage {
  orders: OrderSummary[];
  nextCursor: string | null;
  /** The orders matching the filters across all pages. */
  total: number;
}

function toOrderSummary(value: unknown): OrderSummary | null {
  if (!isObject(value)) return null;
  const { id, code, status, customer, currency, total, sourceReference, createdAt } = value;
  if (!isText(id) || !isText(code) || !isStatus(status) || !isObject(customer) || !isText(customer.id)) return null;
  const reference = sourceReference ?? null;
  if (!isCurrency(currency) || !isText(total) || !isTextOrNull(reference) || !isText(createdAt)) return null;
  return { id, code, status, customerId: customer.id, currency, total, sourceReference: reference, createdAt };
}

/** One page of the organization's storefront orders, newest first as Sales orders them. */
export async function listStorefrontOrders(
  organizationId: string,
  query: OrderListQuery,
  env: Env = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<OrderPage> {
  const op = 'GET /internal/orders';
  const params = new URLSearchParams({ source: 'storefront' });
  for (const status of query.status ?? []) params.append('status', status);
  if (query.siteId) params.set('sourceReference', query.siteId);
  if (query.cursor) params.set('cursor', query.cursor);
  if (query.limit !== undefined) params.set('limit', String(query.limit));
  const response = await call(op, `/internal/orders?${params}`, { method: 'GET', organizationId, timeoutMs: READ_TIMEOUT_MS }, env, fetchImpl);
  if (response.status === 400 && query.cursor) throw new InvalidCursorError();
  if (!response.ok) throw await failure(op, response);
  const body = (await response.json().catch(() => undefined)) as { success?: unknown; data?: { items?: unknown; nextCursor?: unknown; total?: unknown } } | undefined;
  const data = body?.success === true ? body.data : undefined;
  const orders = Array.isArray(data?.items) ? data.items.map(toOrderSummary) : null;
  const nextCursor = data?.nextCursor;
  const total = data?.total;
  if (!orders || orders.some((order) => order === null) || !isTextOrNull(nextCursor) || typeof total !== 'number' || !Number.isInteger(total) || total < 0) {
    throw new SalesUnavailableError(`Sales answered ${op} with an unexpected body`);
  }
  return { orders: orders as OrderSummary[], nextCursor, total };
}

/** The user a status change names: a user of the organization, or the storefront itself. */
export interface OrderActor {
  id: string;
  kind: 'user' | 'storefront';
  /** Null when the user is no longer a member of the organization. */
  name: string | null;
}

/** One status change of an order. */
export interface OrderHistoryEntry {
  /** Null on the entry that records the creation. */
  fromStatus: OrderStatus | null;
  toStatus: OrderStatus;
  reason: string | null;
  /** Null when another app made the change through the service API. */
  changedBy: OrderActor | null;
  changedAt: string;
}

/** A storefront order as the Orders detail shows it. */
export interface StorefrontOrder extends SalesOrder {
  status: OrderStatus;
  customerId: string;
  branchId: string;
  sourceReference: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  history: OrderHistoryEntry[];
}

function toActor(value: unknown): OrderActor | null | undefined {
  if (value === null) return null;
  if (!isObject(value) || !isText(value.id) || (value.kind !== 'user' && value.kind !== 'storefront')) return undefined;
  const name = value.name ?? null;
  if (!isTextOrNull(name)) return undefined;
  return { id: value.id, kind: value.kind, name };
}

function toHistoryEntry(value: unknown): OrderHistoryEntry | null {
  if (!isObject(value)) return null;
  const { fromStatus, toStatus, reason, changedBy, changedAt } = value;
  const why = reason ?? null;
  if ((fromStatus !== null && !isStatus(fromStatus)) || !isStatus(toStatus) || !isTextOrNull(why) || !isText(changedAt)) return null;
  const actor = toActor(changedBy);
  if (actor === undefined) return null;
  return { fromStatus: fromStatus as OrderStatus | null, toStatus, reason: why, changedBy: actor, changedAt };
}

/** The order as the internal read answers it, with the status history when Sales sends one; null when a field is missing or of another type. */
export function toStorefrontOrder(data: unknown): StorefrontOrder | null {
  const base = toSalesOrder(data);
  if (!base || !isObject(data)) return null;
  const { status, customer, branchId, sourceReference, notes, createdAt, updatedAt, history } = data;
  const reference = sourceReference ?? null;
  const note = notes ?? null;
  if (!isStatus(status) || !isObject(customer) || !isText(customer.id) || !isText(branchId) || !isTextOrNull(reference)) return null;
  if (!isTextOrNull(note) || !isText(createdAt) || !isText(updatedAt)) return null;
  let entries: Array<OrderHistoryEntry | null> = [];
  if (history !== undefined) {
    if (!Array.isArray(history)) return null;
    entries = history.map(toHistoryEntry);
    if (entries.some((entry) => entry === null)) return null;
  }
  return {
    ...base,
    status,
    customerId: customer.id,
    branchId,
    sourceReference: reference,
    notes: note,
    createdAt,
    updatedAt,
    history: entries as OrderHistoryEntry[],
  };
}

/** One storefront order of the organization; null when Sales has none with this id, or it is not a storefront order. */
export async function getStorefrontOrder(organizationId: string, orderId: string, env: Env = process.env, fetchImpl: typeof fetch = fetch): Promise<StorefrontOrder | null> {
  const op = 'GET /internal/orders/{id}';
  const response = await call(op, `/internal/orders/${encodeURIComponent(orderId)}`, { method: 'GET', organizationId, timeoutMs: READ_TIMEOUT_MS }, env, fetchImpl);
  if (response.status === 404) return null;
  if (!response.ok) throw await failure(op, response);
  const body = (await response.json().catch(() => undefined)) as { success?: unknown; data?: unknown } | undefined;
  const source = body?.success === true && isObject(body.data) ? body.data.source : undefined;
  if (typeof source === 'string' && source !== 'storefront') return null;
  const order = typeof source === 'string' ? toStorefrontOrder(body?.data) : null;
  if (!order) throw new SalesUnavailableError(`Sales answered ${op} with an unexpected body`);
  return order;
}

/** Confirm, or cancel with the reason the user typed. Delivered and finished are set in Sales only. */
export type StatusChange = { status: 'confirmed' } | { status: 'cancelled'; reason: string };

/**
 * Confirm or cancel a storefront order on behalf of one of the organization's users. 'changed' when Sales did it,
 * 'not_found' when it has no such order. Throws SalesPermissionMissingError when the user lacks the x flag on
 * sales.manage_orders, SalesStatusRefusedError for a rule of the order, SalesUnavailableError for anything else.
 */
export async function changeOrderStatus(
  organizationId: string,
  orderId: string,
  actingUserId: string,
  change: StatusChange,
  env: Env = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<'changed' | 'not_found'> {
  const op = 'POST /internal/orders/{id}/status';
  const response = await call(
    op,
    `/internal/orders/${encodeURIComponent(orderId)}/status`,
    { method: 'POST', organizationId, body: { ...change, actingUserId }, timeoutMs: STATUS_TIMEOUT_MS },
    env,
    fetchImpl,
  );
  if (response.ok) return 'changed';
  if (response.status === 404) {
    // Fastify's own "Route POST:… not found" is a Sales that has no status route yet (SL3 not deployed), not an order that is missing.
    const body = (await response.json().catch(() => undefined)) as { message?: unknown } | undefined;
    if (typeof body?.message === 'string' && body.message.startsWith('Route ')) throw new SalesUnavailableError(`Sales has no status route yet: ${op} answered 404 "${body.message}"`);
    return 'not_found';
  }
  if (response.status === 403 || response.status === 409 || response.status === 422) {
    const body = (await response.json().catch(() => undefined)) as { code?: unknown; message?: unknown } | undefined;
    if (!body || typeof body.code !== 'string') throw new SalesUnavailableError(`Sales answered ${response.status} to ${op} with no code`);
    const message = `Sales refused the status change: ${body.code}${typeof body.message === 'string' ? ` (${body.message})` : ''}`;
    if (response.status === 403 && body.code === 'permission_missing') throw new SalesPermissionMissingError(message);
    throw new SalesStatusRefusedError(response.status, body.code, message);
  }
  throw await failure(op, response);
}
