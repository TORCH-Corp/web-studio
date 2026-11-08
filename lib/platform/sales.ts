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

type Env = Record<string, string | undefined>;

/** The create calls Contact Center, Product & Services and Organization Setup in turn; a retry of a slow create is answered by the order it made. */
const CREATE_TIMEOUT_MS = 20_000;
const READ_TIMEOUT_MS = 5_000;
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
