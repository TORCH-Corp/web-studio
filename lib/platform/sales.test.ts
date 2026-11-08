import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createOrderBody, createStorefrontOrder, getOrder, SalesRefusedError, SalesUnavailableError, toSalesOrder, type StorefrontOrderInput } from './sales';

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
