import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  changeOrderStatus,
  createOrderBody,
  createStorefrontOrder,
  getOrder,
  getStorefrontOrder,
  InvalidCursorError,
  listStorefrontOrders,
  SalesPermissionMissingError,
  SalesRefusedError,
  SalesStatusRefusedError,
  SalesUnavailableError,
  toSalesOrder,
  toStorefrontOrder,
  type StorefrontOrderInput,
} from './sales';

const ENV = { SALES_URL: 'http://sales-service:6029/', SALES_API_KEY: 'sales-key' };
const ORG = '0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a';
const ORDER = '2c2c2c2c-2c2c-4c2c-8c2c-2c2c2c2c2c2c';
const ITEM = '48484848-0001-4848-8848-484848484848';
const answer = (status: number, body: unknown) => (async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })) as unknown as typeof fetch;

const INPUT: StorefrontOrderInput = {
  siteId: 'site-1',
  checkoutId: 'checkout-1',
  personId: 'person-1',
  branchId: 'branch-1',
  currency: 'IQD',
  lines: [{ itemId: ITEM, quantity: '2' }],
  deliveryFee: '2500.00',
  address: { city: 'بغداد', address: 'الكرادة، شارع 62', landmark: null, phone: '0770 123 4567' },
  notes: null,
};

test('the service create\'s body: storefront, the site as reference, the checkout, the person, cash on delivery, no price and nothing empty', () => {
  assert.deepEqual(createOrderBody(INPUT), {
    source: 'storefront',
    sourceReference: 'site-1',
    checkoutId: 'checkout-1',
    customer: { kind: 'PERSON', id: 'person-1' },
    branchId: 'branch-1',
    currency: 'IQD',
    lines: [{ itemId: ITEM, quantity: '2' }],
    deliveryFee: '2500.00',
    paymentMethod: 'cash_on_delivery',
    deliveryAddress: { city: 'بغداد', address: 'الكرادة، شارع 62', phone: '0770 123 4567' },
  });
  const full = createOrderBody({ ...INPUT, address: { ...INPUT.address, landmark: 'قرب الجامع' }, notes: 'اتصل قبل الظهر' });
  assert.deepEqual(full.deliveryAddress, { city: 'بغداد', address: 'الكرادة، شارع 62', phone: '0770 123 4567', landmark: 'قرب الجامع' });
  assert.equal(full.notes, 'اتصل قبل الظهر');
});

test('a new order answers 201 and one Sales already had for the checkout 200, posted with the service key and the organization', async () => {
  let seen: { url: string; method?: string; headers: Headers } | null = null;
  const fetchImpl = (async (url: string, init: RequestInit) => {
    seen = { url, method: init.method, headers: new Headers(init.headers) };
    return new Response(JSON.stringify({ success: true, data: { id: ORDER.toUpperCase(), code: 'SO-2026-0142', status: 'draft' } }), { status: 201 });
  }) as unknown as typeof fetch;
  assert.deepEqual(await createStorefrontOrder(ORG, INPUT, ENV, fetchImpl), { id: ORDER, code: 'SO-2026-0142', created: true });
  assert.equal(seen!.url, 'http://sales-service:6029/internal/orders');
  assert.equal(seen!.method, 'POST');
  assert.equal(seen!.headers.get('x-service-api-key'), 'sales-key');
  assert.equal(seen!.headers.get('x-entity-id'), ORG);
  assert.deepEqual(await createStorefrontOrder(ORG, INPUT, ENV, answer(200, { success: true, data: { id: ORDER, code: 'SO-2026-0142', status: 'confirmed' } })), { id: ORDER, code: 'SO-2026-0142', created: false });
});

test('a 422 is SalesRefusedError with its code and the item ids it names', async () => {
  const refused = await createStorefrontOrder(ORG, INPUT, ENV, answer(422, { statusCode: 422, error: 'Unprocessable Entity', message: 'Item LMP-001 is not active', code: 'item_inactive', items: [ITEM, 42, 'x'] })).catch((e) => e);
  assert.ok(refused instanceof SalesRefusedError);
  assert.equal(refused.code, 'item_inactive');
  assert.deepEqual(refused.items, [ITEM]);
  const branch = await createStorefrontOrder(ORG, INPUT, ENV, answer(422, { code: 'branch_not_found', message: 'No such branch' })).catch((e) => e);
  assert.ok(branch instanceof SalesRefusedError);
  assert.deepEqual([branch.code, branch.items], ['branch_not_found', []]);
  await assert.rejects(createStorefrontOrder(ORG, INPUT, ENV, answer(422, { message: 'no code' })), SalesUnavailableError);
});

test('a 400 is a contract mismatch, not an outage; every other failure is SalesUnavailableError', async () => {
  const mismatch = await createStorefrontOrder(ORG, INPUT, ENV, answer(400, { message: 'body must NOT have additional properties' })).catch((e) => e);
  assert.ok(mismatch instanceof Error && !(mismatch instanceof SalesUnavailableError));
  assert.match(mismatch.message, /Sales answered 400 to POST \/internal\/orders: .*additional properties/);
  for (const [status, body] of [[401, ''], [403, ''], [502, { code: 'contact_center_unavailable' }], [503, ''], [201, { success: true, data: { id: 'x', code: 'SO-1' } }], [201, 'not json']] as const) {
    await assert.rejects(createStorefrontOrder(ORG, INPUT, ENV, answer(status, body)), SalesUnavailableError, `${status}`);
  }
  const down = (async () => {
    throw new TypeError('fetch failed');
  }) as unknown as typeof fetch;
  await assert.rejects(createStorefrontOrder(ORG, INPUT, ENV, down), /Sales is not reachable/);
  await assert.rejects(createStorefrontOrder(ORG, INPUT, {}, down), /SALES_URL and SALES_API_KEY are not set/);
});

const ORDER_OBJECT = {
  id: ORDER,
  code: 'SO-2026-0142',
  status: 'draft',
  customer: { kind: 'PERSON', id: 'person-1' },
  branchId: 'branch-1',
  currency: 'IQD',
  exchangeRate: null,
  lines: [{
    itemId: ITEM, sku: 'LMP-001', name: { en: 'Desk lamp', ar: 'مصباح مكتب' }, unit: { code: 'UOM-000001', name: 'Piece' }, quantity: '2',
    baseUnitPrice: '25000', baseCurrency: 'IQD', unitPrice: '25000', isManualPrice: false, discount: null, discountAmount: '0', lineAmount: '50000', lineTotal: '50000', axes: [],
  }],
  subtotal: '50000', lineDiscountTotal: '0', discount: null, discountAmount: '0', deliveryFee: '2500', total: '52500', totalIqd: '52500',
  paymentMethod: 'cash_on_delivery',
  deliveryAddress: { city: 'بغداد', address: 'الكرادة', landmark: null, phone: '0770 123 4567' },
  source: 'storefront', sourceReference: 'site-1', notes: null, createdBy: '00000000-0000-0000-0000-000000000002',
};

test('the order read takes the fields the confirmation shows, and nothing it cannot trust', async () => {
  let url = '';
  const fetchImpl = (async (asked: string) => {
    url = asked;
    return new Response(JSON.stringify({ success: true, data: ORDER_OBJECT }));
  }) as unknown as typeof fetch;
  const order = await getOrder(ORG, ORDER, ENV, fetchImpl);
  assert.equal(url, `http://sales-service:6029/internal/orders/${ORDER}`);
  assert.deepEqual(order, {
    id: ORDER, code: 'SO-2026-0142', currency: 'IQD',
    lines: [{ itemId: ITEM, sku: 'LMP-001', name: { en: 'Desk lamp', ar: 'مصباح مكتب' }, axes: [], unit: { code: 'UOM-000001', name: 'Piece' }, quantity: '2', unitPrice: '25000', lineTotal: '50000' }],
    subtotal: '50000', deliveryFee: '2500', total: '52500', paymentMethod: 'cash_on_delivery',
    deliveryAddress: { city: 'بغداد', address: 'الكرادة', landmark: null, phone: '0770 123 4567' },
  });
  assert.equal(await getOrder(ORG, ORDER, ENV, answer(404, { message: 'Order not found' })), null);
  await assert.rejects(getOrder(ORG, ORDER, ENV, answer(503, '')), SalesUnavailableError);
  await assert.rejects(getOrder(ORG, ORDER, ENV, answer(200, { success: true, data: { ...ORDER_OBJECT, deliveryFee: undefined } })), /unexpected body/);
});

test('an order Sales answers without SL1\'s fields, or with a line it cannot name, is not an order the confirmation shows', () => {
  assert.notEqual(toSalesOrder(ORDER_OBJECT), null);
  const without = (key: string) => Object.fromEntries(Object.entries(ORDER_OBJECT).filter(([k]) => k !== key));
  for (const key of ['deliveryFee', 'paymentMethod', 'deliveryAddress', 'total', 'subtotal', 'lines', 'code']) {
    assert.equal(toSalesOrder(without(key)), null, key);
  }
  const line = ORDER_OBJECT.lines[0];
  assert.equal(toSalesOrder({ ...ORDER_OBJECT, lines: [{ ...line, axes: undefined }] }), null);
  assert.equal(toSalesOrder({ ...ORDER_OBJECT, lines: [{ ...line, axes: [{ specification: 'Size', option: 'M' }] }] }), null);
  assert.equal(toSalesOrder({ ...ORDER_OBJECT, currency: 'EUR' }), null);
  assert.equal(toSalesOrder({ ...ORDER_OBJECT, deliveryAddress: { city: 'x', address: 'y', landmark: null } }), null);
  assert.deepEqual(toSalesOrder({ ...ORDER_OBJECT, deliveryAddress: null })?.deliveryAddress, null);
  assert.deepEqual(toSalesOrder({ ...ORDER_OBJECT, lines: [{ ...line, axes: [{ specification: { en: 'Size', ar: null }, option: { en: 'M', ar: 'وسط' } }] }] })?.lines[0].axes, [
    { specification: { en: 'Size', ar: null }, option: { en: 'M', ar: 'وسط' } },
  ]);
});

// ---------------------------------------------------------------------------
// The Orders API (part 2, session W8): list, read, confirm and cancel
// ---------------------------------------------------------------------------

const ACTING_USER = '3d3d3d3d-3d3d-4d3d-8d3d-3d3d3d3d3d3d';
const STOREFRONT = { id: '00000000-0000-0000-0000-000000000002', kind: 'storefront', name: 'Storefront (Web Studio)' };
const HISTORY = [
  { fromStatus: null, toStatus: 'draft', reason: null, changedBy: STOREFRONT, changedAt: '2026-11-21T08:00:00.000Z' },
  { fromStatus: 'draft', toStatus: 'cancelled', reason: 'Buyer called to cancel', changedBy: { id: ACTING_USER, kind: 'user', name: 'Sara Ali' }, changedAt: '2026-11-21T09:30:00.000Z' },
];
const STAMPS = { createdAt: '2026-11-21T08:00:00.000Z', updatedAt: '2026-11-21T09:30:00.000Z' };

/** Records the requests; answers each with the next canned response. */
function recorder(...responses: Array<{ status: number; body: unknown }>) {
  const seen: Array<{ url: string; method?: string; headers: Headers; body: unknown }> = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    seen.push({ url, method: init.method, headers: new Headers(init.headers), body: init.body === undefined ? undefined : JSON.parse(String(init.body)) });
    const next = responses[Math.min(seen.length - 1, responses.length - 1)];
    return new Response(typeof next.body === 'string' ? next.body : JSON.stringify(next.body), { status: next.status });
  }) as unknown as typeof fetch;
  return { seen, fetchImpl };
}

test('the list asks Sales for the organization\'s storefront orders with the filters it was given, and keeps the fields a row needs', async () => {
  const { seen, fetchImpl } = recorder({
    status: 200,
    body: { success: true, data: { items: [{ ...ORDER_OBJECT, ...STAMPS }], nextCursor: 'next-1', total: 41 } },
  });
  const page = await listStorefrontOrders(ORG, { status: ['draft', 'confirmed'], siteId: 'site-1', cursor: 'cur-0', limit: 25 }, ENV, fetchImpl);
  assert.equal(seen.length, 1);
  const url = new URL(seen[0].url);
  assert.equal(`${url.origin}${url.pathname}`, 'http://sales-service:6029/internal/orders');
  assert.deepEqual(url.searchParams.getAll('source'), ['storefront']);
  assert.deepEqual(url.searchParams.getAll('status'), ['draft', 'confirmed']);
  assert.equal(url.searchParams.get('sourceReference'), 'site-1');
  assert.equal(url.searchParams.get('cursor'), 'cur-0');
  assert.equal(url.searchParams.get('limit'), '25');
  assert.equal(seen[0].method, 'GET');
  assert.equal(seen[0].headers.get('x-service-api-key'), 'sales-key');
  assert.equal(seen[0].headers.get('x-entity-id'), ORG);
  assert.deepEqual(page, {
    orders: [{ id: ORDER, code: 'SO-2026-0142', status: 'draft', customerId: 'person-1', currency: 'IQD', total: '52500', sourceReference: 'site-1', createdAt: '2026-11-21T08:00:00.000Z' }],
    nextCursor: 'next-1',
    total: 41,
  });
});

test('a list without filters asks for the storefront source alone, and the last page has no cursor', async () => {
  const { seen, fetchImpl } = recorder({ status: 200, body: { success: true, data: { items: [], nextCursor: null, total: 0 } } });
  assert.deepEqual(await listStorefrontOrders(ORG, {}, ENV, fetchImpl), { orders: [], nextCursor: null, total: 0 });
  assert.equal(new URL(seen[0].url).search, '?source=storefront');
});

test('Sales refusing the cursor is InvalidCursorError; refusing anything else it was sent is a contract mismatch; other failures are SalesUnavailableError', async () => {
  await assert.rejects(listStorefrontOrders(ORG, { cursor: 'garbage' }, ENV, answer(400, { message: 'invalid cursor' })), InvalidCursorError);
  const mismatch = await listStorefrontOrders(ORG, {}, ENV, answer(400, { message: 'querystring must NOT have additional properties' })).catch((e) => e);
  assert.ok(mismatch instanceof Error && !(mismatch instanceof SalesUnavailableError) && !(mismatch instanceof InvalidCursorError));
  for (const [status, body] of [[401, ''], [503, ''], [200, { success: true, data: { items: [{ id: 'x' }], nextCursor: null, total: 1 } }], [200, { success: true, data: { items: [], nextCursor: null } }], [200, 'not json']] as const) {
    await assert.rejects(listStorefrontOrders(ORG, {}, ENV, answer(status, body)), SalesUnavailableError, `${status}`);
  }
});

test('one order carries its lines, the buyer\'s id, the notes, the stamps and the status history with the actors', async () => {
  const { seen, fetchImpl } = recorder({ status: 200, body: { success: true, data: { ...ORDER_OBJECT, ...STAMPS, notes: 'Call first', status: 'cancelled', history: HISTORY } } });
  const order = await getStorefrontOrder(ORG, ORDER, ENV, fetchImpl);
  assert.equal(seen[0].url, `http://sales-service:6029/internal/orders/${ORDER}`);
  assert.equal(order?.status, 'cancelled');
  assert.equal(order?.customerId, 'person-1');
  assert.equal(order?.branchId, 'branch-1');
  assert.equal(order?.sourceReference, 'site-1');
  assert.equal(order?.notes, 'Call first');
  assert.equal(order?.createdAt, '2026-11-21T08:00:00.000Z');
  assert.equal(order?.lines[0].sku, 'LMP-001');
  assert.equal(order?.paymentMethod, 'cash_on_delivery');
  assert.deepEqual(order?.history, HISTORY);
});

test('an order read without a history has an empty one; a history Sales sends badly is an unexpected body', async () => {
  const withoutHistory = await getStorefrontOrder(ORG, ORDER, ENV, answer(200, { success: true, data: { ...ORDER_OBJECT, ...STAMPS } }));
  assert.deepEqual(withoutHistory?.history, []);
  const bad = { ...ORDER_OBJECT, ...STAMPS };
  assert.equal(toStorefrontOrder({ ...bad, history: 'none' }), null);
  assert.equal(toStorefrontOrder({ ...bad, history: [{ ...HISTORY[0], toStatus: 'shipped' }] }), null);
  assert.equal(toStorefrontOrder({ ...bad, history: [{ ...HISTORY[0], changedBy: { id: 'x', kind: 'robot', name: null } }] }), null);
  assert.equal(toStorefrontOrder({ ...bad, history: [{ ...HISTORY[0], changedAt: undefined }] }), null);
  // The service create's other app made the change: no actor (changedBy null), a user no longer in the organization: no name.
  assert.deepEqual(toStorefrontOrder({ ...bad, history: [{ ...HISTORY[1], changedBy: null }, { ...HISTORY[1], changedBy: { id: ACTING_USER, kind: 'user', name: null } }] })?.history.map((e) => e.changedBy), [null, { id: ACTING_USER, kind: 'user', name: null }]);
  await assert.rejects(getStorefrontOrder(ORG, ORDER, ENV, answer(200, { success: true, data: { ...bad, history: 'none' } })), /unexpected body/);
});

test('an order that is not a storefront order, or that Sales does not have, is null', async () => {
  assert.equal(await getStorefrontOrder(ORG, ORDER, ENV, answer(404, { message: 'Order not found' })), null);
  assert.equal(await getStorefrontOrder(ORG, ORDER, ENV, answer(200, { success: true, data: { ...ORDER_OBJECT, ...STAMPS, source: 'chat', sourceReference: 'conversation-1' } })), null);
  await assert.rejects(getStorefrontOrder(ORG, ORDER, ENV, answer(503, '')), SalesUnavailableError);
  // An order object with no source at all is not a "not a storefront order": it is a body that cannot be read.
  const { source: _source, ...withoutSource } = { ...ORDER_OBJECT, ...STAMPS };
  await assert.rejects(getStorefrontOrder(ORG, ORDER, ENV, answer(200, { success: true, data: withoutSource })), /unexpected body/);
});

test('confirming posts the status and the acting user to the service route; cancelling adds the reason', async () => {
  const done = { status: 200, body: { success: true, data: { id: ORDER } } };
  const confirm = recorder(done);
  assert.equal(await changeOrderStatus(ORG, ORDER, ACTING_USER, { status: 'confirmed' }, ENV, confirm.fetchImpl), 'changed');
  assert.equal(confirm.seen[0].url, `http://sales-service:6029/internal/orders/${ORDER}/status`);
  assert.equal(confirm.seen[0].method, 'POST');
  assert.equal(confirm.seen[0].headers.get('x-service-api-key'), 'sales-key');
  assert.equal(confirm.seen[0].headers.get('x-entity-id'), ORG);
  assert.equal(confirm.seen[0].headers.get('content-type'), 'application/json');
  assert.deepEqual(confirm.seen[0].body, { status: 'confirmed', actingUserId: ACTING_USER });

  const cancel = recorder(done);
  assert.equal(await changeOrderStatus(ORG, ORDER, ACTING_USER, { status: 'cancelled', reason: 'Buyer called to cancel' }, ENV, cancel.fetchImpl), 'changed');
  assert.deepEqual(cancel.seen[0].body, { status: 'cancelled', reason: 'Buyer called to cancel', actingUserId: ACTING_USER });
});

test('Sales answering for the status change: permission_missing, a rule, no such order, a contract mismatch, an outage', async () => {
  const change = (status: number, body: unknown) => changeOrderStatus(ORG, ORDER, ACTING_USER, { status: 'confirmed' }, ENV, answer(status, body));
  await assert.rejects(change(403, { statusCode: 403, code: 'permission_missing', message: 'sales.manage_orders x is missing' }), SalesPermissionMissingError);
  const notStorefront = await change(403, { statusCode: 403, code: 'not_a_storefront_order', message: 'Only storefront orders' }).catch((e) => e);
  assert.ok(notStorefront instanceof SalesStatusRefusedError);
  assert.deepEqual([notStorefront.httpStatus, notStorefront.code], [403, 'not_a_storefront_order']);
  const transition = await change(422, { statusCode: 422, code: 'invalid_transition', message: 'A cancelled order takes no further status' }).catch((e) => e);
  assert.ok(transition instanceof SalesStatusRefusedError);
  assert.deepEqual([transition.httpStatus, transition.code], [422, 'invalid_transition']);
  const invoiced = await change(409, { statusCode: 409, code: 'order_invoiced', message: 'Its invoice is issued' }).catch((e) => e);
  assert.deepEqual([invoiced.httpStatus, invoiced.code], [409, 'order_invoiced']);
  assert.equal(await change(404, { message: 'Order not found' }), 'not_found');
  // A Sales that has no status route yet (SL3 not deployed) answers 404 for the route, not for the order.
  await assert.rejects(change(404, { message: 'Route POST:/internal/orders/x/status not found', error: 'Not Found', statusCode: 404 }), /has no status route/);
  await assert.rejects(change(404, { message: 'Route POST:/internal/orders/x/status not found', error: 'Not Found', statusCode: 404 }), SalesUnavailableError);
  const mismatch = await change(400, { message: 'body must NOT have additional properties' }).catch((e) => e);
  assert.ok(mismatch instanceof Error && !(mismatch instanceof SalesUnavailableError) && !(mismatch instanceof SalesStatusRefusedError));
  for (const [status, body] of [[401, ''], [502, { code: 'org_setup_unavailable' }], [503, ''], [403, 'forbidden'], [422, { message: 'no code' }]] as const) {
    await assert.rejects(change(status, body), SalesUnavailableError, `${status}`);
  }
});
