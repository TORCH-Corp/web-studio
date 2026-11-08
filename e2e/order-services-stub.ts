/**
 * Contact Center and Sales as the checkout calls them (part 2, session W3), in
 * the platform stub's server (e2e/platform-stub.ts), recording every call so a
 * spec can count them. Shapes are the live Contact Center route (C1, deployed
 * 8 Nov 2026) and Sales's service create as the session plan defines it (SL2,
 * amended 8 Nov: the typed phone on the address, the refused item ids on a 422),
 * with SL1's order fields.
 *
 * Contact Center, `x-service-api-key` (401) and `x-entity-id` (400):
 *   POST /api/v1/internal/persons/find-or-create { name, phone, origin }
 *        → 201 { person_id, created: true } for a new number, 200 with created
 *          false for one the organization has in its canonical form (964).
 *
 * Sales, `x-service-api-key` (401) and `x-entity-id` (400):
 *   POST /internal/orders   SL2's body, `additionalProperties: false` at every
 *        level (400 otherwise) → 201 { success, data: order } once per
 *        organization and checkoutId, 200 with the same order after; 422 with
 *        code and items for an unknown customer or branch and for items that
 *        cannot be sold (unknown, not ACTIVE, a parent, no price, no rate);
 *        prices from e2e/platform-fixtures.ts, converted at USD_IQD_RATE.
 *   GET  /internal/orders/{id}   → { success, data: order } or 404.
 *
 * For the specs (the platform stub routes these here):
 *   GET  /__calls?service=contact-center|sales   { calls: [{ method, path, entityId, body, status, response }] }
 *   POST /__sales/refuse { code, items }         the next create answers 422 with them, once
 *   POST /__sales/delay { ms }                   each create waits this long before it answers
 */

import type http from 'node:http';
import { randomUUID } from 'node:crypto';
import { convert, displayAmount, type StoreCurrency } from '../lib/platform/store-money';
import { BRANCHES, CONTACT_CENTER_KEY, ITEMS, SALES_KEY, SPECIFICATIONS, UNITS, USD_IQD_RATE, type FixtureItem } from './platform-fixtures';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const QUANTITY = /^(?!0+(\.0+)?$)[0-9]{1,12}(\.[0-9]{1,4})?$/;
const MONEY = /^[0-9]{1,14}(\.[0-9]+)?$/;

export type OrderService = 'contact-center' | 'sales';

interface Call {
  method: string;
  path: string;
  entityId: string | null;
  body: unknown;
  status: number;
  response: unknown;
}

interface Person {
  id: string;
  entityId: string;
  name: string;
  phone: string;
  canonical: string;
}

interface Order {
  entityId: string;
  checkoutId: string;
  data: Record<string, unknown>;
}

const calls: Record<OrderService, Call[]> = { 'contact-center': [], sales: [] };
const persons: Person[] = [];
const orders = new Map<string, Order>();
let orderNumber = 0;
let refuseNext: { code: string; items: string[] } | null = null;
let createDelayMs = 0;

type Reply = (response: http.ServerResponse, status: number, body: unknown) => void;

/** Contact Center's canonicalPhone (country code 964): digits; + and 00 dropped; 0 becomes 964. */
function canonicalPhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (raw.trim().startsWith('+')) return digits;
  if (digits.startsWith('00')) return digits.slice(2);
  if (digits.startsWith('0')) return `964${digits.slice(1)}`;
  return digits;
}

const onlyKeys = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).every((key) => keys.includes(key));
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

async function readBody(request: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null');
  } catch {
    return undefined;
  }
}

function record(service: OrderService, request: http.IncomingMessage, path: string, body: unknown, status: number, response: unknown): void {
  const entityId = request.headers['x-entity-id'];
  calls[service].push({ method: request.method ?? 'GET', path, entityId: typeof entityId === 'string' ? entityId : null, body, status, response });
}

/** The service key and the organization; null when they hold, the refusal otherwise. */
function credentials(request: http.IncomingMessage, key: string): { status: number; message: string } | null {
  if (request.headers['x-service-api-key'] !== key) return { status: 401, message: 'Invalid or missing service API key' };
  const entityId = request.headers['x-entity-id'];
  if (typeof entityId !== 'string' || !UUID.test(entityId)) return { status: 400, message: 'x-entity-id must be a uuid' };
  return null;
}

async function findOrCreate(request: http.IncomingMessage, response: http.ServerResponse, path: string, down: boolean, json: Reply): Promise<void> {
  const body = await readBody(request);
  const answer = (status: number, payload: unknown) => {
    record('contact-center', request, path, body, status, payload);
    json(response, status, payload);
  };
  const refused = credentials(request, CONTACT_CENTER_KEY);
  if (refused) return answer(refused.status, { message: refused.message });
  if (down) return answer(503, { error: 'Service Unavailable' });
  if (!isObject(body) || typeof body.name !== 'string' || !/\S/.test(body.name) || body.name.length > 255) return answer(400, { message: 'body/name is invalid' });
  if (typeof body.phone !== 'string' || body.phone.length < 1 || body.phone.length > 20) return answer(400, { message: 'body/phone is invalid' });
  if (body.origin !== 'storefront') return answer(400, { message: 'body/origin must be storefront' });
  const canonical = canonicalPhone(body.phone);
  if (canonical.length < 7) return answer(400, { message: 'A phone needs at least 7 digits' });
  const entityId = request.headers['x-entity-id'] as string;
  const found = persons.find((person) => person.entityId === entityId && person.canonical === canonical);
  if (found) return answer(200, { person_id: found.id, created: false });
  const person = { id: randomUUID(), entityId, name: body.name, phone: body.phone, canonical };
  persons.push(person);
  return answer(201, { person_id: person.id, created: true });
}

/** SL2's body, every level closed; a message for the first thing wrong, null when it holds. */
function invalidCreate(body: unknown): string | null {
  if (!isObject(body)) return 'body must be an object';
  const keys = ['source', 'sourceReference', 'checkoutId', 'customer', 'branchId', 'currency', 'lines', 'deliveryFee', 'paymentMethod', 'deliveryAddress', 'notes'];
  if (!onlyKeys(body, keys)) return 'body must NOT have additional properties';
  if (body.source !== 'storefront') return 'body/source must be storefront';
  if (typeof body.sourceReference !== 'string' || body.sourceReference.length < 1 || body.sourceReference.length > 200) return 'body/sourceReference is invalid';
  if (typeof body.checkoutId !== 'string' || !UUID.test(body.checkoutId)) return 'body/checkoutId must be a uuid';
  const customer = body.customer;
  if (!isObject(customer) || !onlyKeys(customer, ['kind', 'id']) || (customer.kind !== 'PERSON' && customer.kind !== 'ORGANIZATION') || typeof customer.id !== 'string' || !UUID.test(customer.id)) return 'body/customer is invalid';
  if (typeof body.branchId !== 'string' || !UUID.test(body.branchId)) return 'body/branchId must be a uuid';
  if (body.currency !== 'IQD' && body.currency !== 'USD') return 'body/currency is invalid';
  if (!Array.isArray(body.lines) || body.lines.length < 1 || body.lines.length > 200) return 'body/lines must hold 1 to 200 lines';
  for (const line of body.lines) {
    if (!isObject(line) || !onlyKeys(line, ['itemId', 'quantity']) || typeof line.itemId !== 'string' || !UUID.test(line.itemId) || typeof line.quantity !== 'string' || !QUANTITY.test(line.quantity)) {
      return 'body/lines has an invalid line';
    }
  }
  if (body.deliveryFee !== undefined && (typeof body.deliveryFee !== 'string' || !MONEY.test(body.deliveryFee))) return 'body/deliveryFee is invalid';
  if (body.paymentMethod !== 'cash_on_delivery') return 'body/paymentMethod must be cash_on_delivery';
  const address = body.deliveryAddress;
  if (!isObject(address) || !onlyKeys(address, ['city', 'address', 'landmark', 'phone'])) return 'body/deliveryAddress is invalid';
  if (typeof address.city !== 'string' || typeof address.address !== 'string' || (address.landmark !== undefined && typeof address.landmark !== 'string')) return 'body/deliveryAddress is invalid';
  if (typeof address.phone !== 'string' || address.phone.length < 1 || address.phone.length > 32) return 'body/deliveryAddress/phone is invalid';
  if (body.notes !== undefined && (typeof body.notes !== 'string' || body.notes.length > 2000)) return 'body/notes is invalid';
  return null;
}

const children = (item: FixtureItem) => ITEMS.filter((child) => child.parent_item_id === item.id);

/** The first rule the items break, with every item that breaks it, as SL2 answers. */
function refusedItems(entityId: string, ids: string[], currency: StoreCurrency): { code: string; items: string[] } | null {
  const unique = Array.from(new Set(ids));
  const item = (id: string) => ITEMS.find((candidate) => candidate.id === id && candidate.entityId === entityId);
  const rules: Array<[string, (id: string) => boolean]> = [
    ['item_not_found', (id) => !item(id)],
    ['item_inactive', (id) => item(id)!.status !== 'ACTIVE'],
    ['item_is_parent', (id) => children(item(id)!).length > 0],
    ['item_no_price', (id) => !item(id)!.base_price],
    ['no_rate_for_date', (id) => item(id)!.currency !== currency && !rateFound()],
  ];
  let left = unique;
  for (const [code, breaks] of rules) {
    const broken = left.filter(breaks);
    if (broken.length) return { code, items: broken };
    left = left.filter((id) => !broken.includes(id));
  }
  return null;
}

let rateFound: () => boolean = () => true;

/** The axes of a variant as SL1 snapshots them on a line. */
function lineAxes(item: FixtureItem) {
  return item.axes.map(({ specification_id, option_id }) => {
    const spec = SPECIFICATIONS.find((s) => s.id === specification_id)!;
    const option = spec.options.find((o) => o.id === option_id)!;
    return { specification: { en: spec.name, ar: spec.name_ar }, option: { en: option.label, ar: option.label_ar } };
  });
}

/** quantity × price at the currency's precision (the e2e quantities are whole). */
function lineTotal(quantity: string, unitPrice: string, currency: StoreCurrency): string {
  return displayAmount((Number(quantity) * Number(unitPrice)).toFixed(currency === 'USD' ? 2 : 0), currency);
}

const sum = (amounts: string[], currency: StoreCurrency) => displayAmount(amounts.reduce((total, amount) => total + Number(amount), 0).toFixed(currency === 'USD' ? 2 : 0), currency);

function makeOrder(entityId: string, body: Record<string, any>): Record<string, unknown> {
  const currency = body.currency as StoreCurrency;
  const lines = (body.lines as Array<{ itemId: string; quantity: string }>).map((line) => {
    const item = ITEMS.find((candidate) => candidate.id === line.itemId)!;
    const base = String(item.base_price);
    const unitPrice = item.currency === currency ? displayAmount(base, currency) : convert(base, item.currency, currency, String(USD_IQD_RATE));
    const unit = UNITS.find((u) => u.id === item.base_uom_id)!;
    const total = lineTotal(line.quantity, unitPrice, currency);
    return {
      itemId: item.id, sku: item.sku, name: { en: item.name, ar: item.name_ar }, unit: { code: unit.code, name: unit.name }, quantity: line.quantity,
      baseUnitPrice: base, baseCurrency: item.currency, unitPrice, isManualPrice: false, discount: null, discountAmount: '0', lineAmount: total, lineTotal: total,
      axes: lineAxes(item),
    };
  });
  const subtotal = sum(lines.map((line) => line.lineTotal), currency);
  const fee = Number(body.deliveryFee ?? '0').toFixed(currency === 'USD' ? 2 : 0);
  const total = sum([subtotal, fee], currency);
  orderNumber += 1;
  const address = body.deliveryAddress as Record<string, string>;
  return {
    id: randomUUID(), code: `SO-2026-${String(orderNumber).padStart(4, '0')}`, status: 'draft', customer: body.customer, branchId: body.branchId, currency,
    exchangeRate: currency === 'USD' ? String(USD_IQD_RATE) : null, lines, subtotal, lineDiscountTotal: '0', discount: null, discountAmount: '0',
    deliveryFee: fee, total, totalIqd: currency === 'IQD' ? total : convert(total, 'USD', 'IQD', String(USD_IQD_RATE)),
    paymentMethod: 'cash_on_delivery', deliveryAddress: { city: address.city, address: address.address, landmark: address.landmark ?? null, phone: address.phone },
    source: 'storefront', sourceReference: body.sourceReference, campaignId: null, quoteId: null, notes: body.notes ?? null,
    createdBy: '00000000-0000-0000-0000-000000000002', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), contactPersonId: null,
  };
}

async function createOrder(request: http.IncomingMessage, response: http.ServerResponse, path: string, down: boolean, json: Reply): Promise<void> {
  const body = await readBody(request);
  const answer = (status: number, payload: unknown) => {
    record('sales', request, path, body, status, payload);
    json(response, status, payload);
  };
  if (createDelayMs) await new Promise((resolve) => setTimeout(resolve, createDelayMs));
  const refused = credentials(request, SALES_KEY);
  if (refused) return answer(refused.status, { statusCode: refused.status, message: refused.message });
  if (down) return answer(503, { statusCode: 503, error: 'Service Unavailable' });
  const invalid = invalidCreate(body);
  if (invalid) return answer(400, { statusCode: 400, error: 'Bad Request', message: invalid });
  const order = body as Record<string, any>;
  const entityId = request.headers['x-entity-id'] as string;
  const key = `${entityId}:${order.checkoutId}`;
  const existing = orders.get(key);
  if (existing) return answer(200, { success: true, data: existing.data });
  const unprocessable = (code: string, items: string[] | undefined, message: string) =>
    answer(422, { statusCode: 422, error: 'Unprocessable Entity', message, code, ...(items ? { items } : {}) });
  if (refuseNext) {
    const { code, items } = refuseNext;
    refuseNext = null;
    return unprocessable(code, items, `Refused by the spec: ${code}`);
  }
  if (!persons.some((person) => person.entityId === entityId && person.id === order.customer.id)) return unprocessable('customer_not_found', undefined, 'No person with this id in Contact Center');
  if (!BRANCHES.some((branch) => branch.id === order.branchId && branch.entityId === entityId && branch.status === 'active')) return unprocessable('branch_not_found', undefined, 'No such branch');
  if (order.currency === 'USD' && !rateFound()) return unprocessable('no_rate_for_date', [], 'No USD rate for today');
  const items = refusedItems(entityId, order.lines.map((line: { itemId: string }) => line.itemId), order.currency);
  if (items) return unprocessable(items.code, items.items, `Refused: ${items.code}`);
  const data = makeOrder(entityId, order);
  orders.set(key, { entityId, checkoutId: order.checkoutId, data });
  return answer(201, { success: true, data });
}

function readOrder(request: http.IncomingMessage, response: http.ServerResponse, path: string, id: string, down: boolean, json: Reply): void {
  const answer = (status: number, payload: unknown) => {
    record('sales', request, path, null, status, payload);
    json(response, status, payload);
  };
  const refused = credentials(request, SALES_KEY);
  if (refused) return answer(refused.status, { statusCode: refused.status, message: refused.message });
  if (down) return answer(503, { statusCode: 503, error: 'Service Unavailable' });
  const entityId = request.headers['x-entity-id'] as string;
  const order = Array.from(orders.values()).find((candidate) => candidate.entityId === entityId && candidate.data.id === id);
  if (!order) return answer(404, { statusCode: 404, error: 'Not Found', message: 'Order not found' });
  return answer(200, { success: true, data: order.data });
}

/**
 * Answer a Contact Center, Sales or control request; false when the path is
 * none of them. `isDown` and `hasRate` are the platform stub's switches.
 */
export async function handleOrderServices(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  url: URL,
  isDown: (service: OrderService) => boolean,
  hasRate: () => boolean,
  json: Reply,
): Promise<boolean> {
  rateFound = hasRate;
  const path = url.pathname;
  const method = request.method;
  if (method === 'POST' && path === '/api/v1/internal/persons/find-or-create') {
    await findOrCreate(request, response, path, isDown('contact-center'), json);
    return true;
  }
  if (method === 'POST' && path === '/internal/orders') {
    await createOrder(request, response, path, isDown('sales'), json);
    return true;
  }
  const read = method === 'GET' ? path.match(/^\/internal\/orders\/([^/]+)$/) : null;
  if (read) {
    readOrder(request, response, path, decodeURIComponent(read[1]), isDown('sales'), json);
    return true;
  }
  if (method === 'GET' && path === '/__calls') {
    const service = url.searchParams.get('service') as OrderService;
    json(response, 200, { calls: calls[service] ?? [] });
    return true;
  }
  if (method === 'POST' && path === '/__sales/refuse') {
    const body = await readBody(request);
    refuseNext = isObject(body) && typeof body.code === 'string' ? { code: body.code, items: Array.isArray(body.items) ? (body.items as string[]) : [] } : null;
    json(response, 200, { refuse: refuseNext });
    return true;
  }
  if (method === 'POST' && path === '/__sales/delay') {
    const body = await readBody(request);
    createDelayMs = isObject(body) && typeof body.ms === 'number' ? body.ms : 0;
    json(response, 200, { ms: createDelayMs });
    return true;
  }
  return false;
}
