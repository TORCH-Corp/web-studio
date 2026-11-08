/**
 * Part 2, session W3's checkout, against the deployed service and the real
 * Contact Center and Sales (session D1, server mode).
 *
 * A buyer on a published, selling site of the test organization checks out the
 * fixture item with the test buyer's phone: Contact Center finds or creates the
 * person, Sales makes one draft order from the storefront, Web Studio stores its
 * id and code. The spec reads the order back from Sales itself (a draft, source
 * storefront, cash on delivery, this site as its reference), checks that a retry
 * is the same order, the confirmation read, and the refusals (a bad body, an item
 * that cannot be bought, another origin, the honeypot, the builder host, a store
 * that stops selling). Every order the run made is CANCELLED at the end through
 * the Orders API's status route, which is Sales's service route with the acting
 * user: the afterAll does it even when an assertion failed.
 */

import { expect, request, test, type APIRequestContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { signInWithToken } from '../helpers';
import { accessToken, CANCEL_REASON, cancelOpenOrders, createSellingSite, deleteSite, ensureStoreItem, SALES_URL, STORE_ITEM, TEST_BUYER, visitor, type SellingSite } from './real-services';

test.describe.configure({ mode: 'serial' });

const RUN = Date.now().toString(36);

let baseURL: string;
let token: string;
let api: APIRequestContext;
let sales: APIRequestContext;
let fixture: { id: string; imageDocumentId: string };
let store: SellingSite;
let shop: APIRequestContext;
let placed: { checkout_id: string; code: string };
let orderId: string;

const checkoutBody = (over: Record<string, unknown> = {}) => ({
  checkout_id: randomUUID(),
  buyer: {
    name: TEST_BUYER.name,
    phone: TEST_BUYER.phone,
    city: 'baghdad',
    address: 'E2E street 1, Karrada',
    landmark: 'Next to the e2e shop',
    notes: 'Made by the Web Studio server e2e; cancelled by the run. Please ignore.',
  },
  lines: [{ item_id: fixture.id, quantity: 2 }],
  locale: 'en',
  ...over,
});
const checkout = (body: unknown, as: APIRequestContext = shop) => as.post('/ycode/api/store/checkout', { data: body });
const confirmation = (checkoutId: string, as: APIRequestContext = shop) => as.get(`/ycode/api/store/orders/${checkoutId}`);

/** The site's orders, from the Orders API (Sales's own list, scoped to this site). */
async function siteOrders(status?: string) {
  const response = await api.get(`/ycode/api/platform/orders?site_id=${store.site.id}${status ? `&status=${status}` : ''}`);
  expect(response.status(), await response.text()).toBe(200);
  return (await response.json()) as { data: Array<{ id: string; code: string; status: string; total: string; currency: string; buyer: { name: string | null } }>; total: number };
}

test.beforeAll(async ({ baseURL: configured }) => {
  baseURL = configured!;
  token = await accessToken();
  api = await signInWithToken(baseURL, token);
  sales = await request.newContext({ baseURL: SALES_URL, extraHTTPHeaders: { authorization: `Bearer ${token}` } });
  fixture = await ensureStoreItem(token);
  store = await createSellingSite(api, RUN, { slugPrefix: 'e2e-chk', name: 'E2E checkout', deliveryFee: 2500 });
  shop = await visitor(store.host);
});

test.afterAll(async () => {
  await cancelOpenOrders(api, store?.site.id);
  await shop?.dispose();
  await sales?.dispose();
  await deleteSite(api, store?.site);
  await api?.dispose();
});

test('a checkout makes one order: the code Sales gave, answered 201', async () => {
  const body = checkoutBody();
  const response = await checkout(body);
  expect(response.status(), await response.text()).toBe(201);
  const answer = await response.json();
  expect(answer.data).toEqual({ checkout_id: body.checkout_id, code: expect.stringMatching(/^SO-\d{4}-\d{4,}$/) });
  placed = answer.data;

  const orders = await siteOrders();
  expect(orders.total).toBe(1);
  expect(orders.data[0]).toMatchObject({ code: placed.code, status: 'draft', currency: 'IQD' });
  expect(Number(orders.data[0].total), '2 x 25000 and the 2500 fee').toBe(52500);
  orderId = orders.data[0].id;
});

test('Sales has it as a draft from the storefront: this site, cash on delivery, the fee, the address, the buyer from Contact Center', async () => {
  const response = await sales.get(`/orders/${orderId}`);
  expect(response.status(), await response.text()).toBe(200);
  const order = (await response.json()).data;
  expect(order).toMatchObject({
    code: placed.code,
    source: 'storefront',
    sourceReference: store.site.id,
    paymentMethod: 'cash_on_delivery',
    currency: 'IQD',
  });
  expect(String(order.status).toLowerCase()).toBe('draft');
  expect(Number(order.deliveryFee)).toBe(2500);
  expect(Number(order.total)).toBe(52500);
  expect(order.lines).toHaveLength(1);
  expect(Number(order.lines[0].quantity)).toBe(2);
  expect(order.deliveryAddress).toMatchObject({ city: 'Baghdad', address: 'E2E street 1, Karrada' });
  // The customer is Contact Center's person, found or made by the canonical phone; the creator is the storefront.
  expect(order.customer).toMatchObject({ kind: 'PERSON', name: TEST_BUYER.name, phone: TEST_BUYER.canonical });
  expect(order.createdBy).toMatchObject({ kind: 'storefront' });

  // The Orders API reads the same order with the buyer from Contact Center.
  const detail = await api.get(`/ycode/api/platform/orders/${orderId}`);
  expect(detail.status(), await detail.text()).toBe(200);
  const read = (await detail.json()).data;
  expect(read).toMatchObject({ id: orderId, code: placed.code, status: 'draft', checkout_id: placed.checkout_id, payment_method: 'cash_on_delivery' });
  expect(read.buyer.name).toBe(TEST_BUYER.name);
  expect(read.site).toMatchObject({ id: store.site.id });
});

test('the same checkout again is the same order, answered 200, and no second order exists', async () => {
  const again = await checkout(checkoutBody({ checkout_id: placed.checkout_id }));
  expect(again.status(), await again.text()).toBe(200);
  expect((await again.json()).data).toEqual({ checkout_id: placed.checkout_id, code: placed.code });
  expect((await siteOrders()).total).toBe(1);
});

test('the confirmation reads the order from Sales: lines, amounts and the number the buyer typed, nothing more of the buyer', async () => {
  const response = await confirmation(placed.checkout_id);
  expect(response.status(), await response.text()).toBe(200);
  const order = (await response.json()).data;
  expect(order).toMatchObject({
    checkout_id: placed.checkout_id,
    code: placed.code,
    currency: 'IQD',
    payment_method: 'cash_on_delivery',
    phone: TEST_BUYER.phone,
  });
  expect(order.lines).toHaveLength(1);
  expect(order.lines[0]).toMatchObject({ item_id: fixture.id, sku: STORE_ITEM.sku, quantity: expect.anything() });
  expect(Number(order.lines[0].quantity)).toBe(2);
  expect(Number(order.lines[0].unit_price)).toBe(STORE_ITEM.price);
  expect(Number(order.lines[0].line_total)).toBe(2 * STORE_ITEM.price);
  expect(Number(order.subtotal)).toBe(50000);
  expect(Number(order.delivery_fee)).toBe(2500);
  expect(Number(order.total)).toBe(52500);
  expect(Object.keys(order)).not.toContain('buyer');
  expect(JSON.stringify(order)).not.toContain(TEST_BUYER.name);

  const unknown = await confirmation(randomUUID());
  expect(unknown.status()).toBe(404);
  expect((await unknown.json()).code).toBe('order_not_found');
});

test('a bad body is refused in the page\'s language with the fields named, an item that cannot be bought is 422, and nothing is created', async () => {
  const bad = await checkout(checkoutBody({ buyer: { name: '', phone: '123', city: 'atlantis', address: '' } }));
  expect(bad.status()).toBe(400);
  const refusal = await bad.json();
  expect(refusal.code).toBe('invalid_checkout');
  expect(Object.keys(refusal.fields).sort()).toEqual(['buyer.address', 'buyer.city', 'buyer.name', 'buyer.phone']);

  const arabic = await checkout(checkoutBody({ locale: 'ar', buyer: { name: '', phone: TEST_BUYER.phone, city: 'baghdad', address: 'x' } }));
  expect(arabic.status()).toBe(400);
  expect(Object.values((await arabic.json()).fields).join(' ')).toMatch(/[؀-ۿ]/);

  const unknownItem = randomUUID();
  const gone = await checkout(checkoutBody({ lines: [{ item_id: unknownItem, quantity: 1 }] }));
  expect(gone.status(), await gone.text()).toBe(422);
  const unavailable = await gone.json();
  expect(unavailable.code).toBe('item_unavailable');
  expect(unavailable.items).toEqual([expect.objectContaining({ item_id: unknownItem })]);

  expect((await siteOrders()).total, 'still the one order').toBe(1);
});

test('another origin is 403, the builder\'s host is 404, and a filled honeypot answers like a success with no order', async () => {
  const foreign = await request.newContext({ baseURL: `https://${store.host}`, extraHTTPHeaders: { origin: 'https://shop.example.com' } });
  try {
    const refused = await checkout(checkoutBody(), foreign);
    expect(refused.status()).toBe(403);
    expect((await refused.json()).code).toBe('cross_origin');
  } finally {
    await foreign.dispose();
  }

  const builder = await request.newContext({ baseURL });
  try {
    const answer = await checkout(checkoutBody(), builder);
    expect(answer.status()).toBe(404);
    expect((await answer.json()).code).toBe('store_not_found');
  } finally {
    await builder.dispose();
  }

  const spam = checkoutBody({ ycode_hp: 'http://spam.example.com' });
  const trapped = await checkout(spam);
  expect(trapped.status(), await trapped.text()).toBe(201);
  expect(await trapped.json()).toEqual({ data: { checkout_id: spam.checkout_id, code: null } });
  expect((await confirmation(spam.checkout_id as string)).status()).toBe(404);
  expect((await siteOrders()).total, 'the honeypot made no order').toBe(1);
});

test('the run cancels its order through the status route: Sales shows it cancelled, with the reason and the acting user in its history', async () => {
  const cancelled = await api.post(`/ycode/api/platform/orders/${orderId}/cancel`, { data: { reason: CANCEL_REASON } });
  expect(cancelled.status(), await cancelled.text()).toBe(200);
  expect((await cancelled.json()).data).toEqual({ id: orderId, status: 'cancelled' });

  const order = (await (await sales.get(`/orders/${orderId}`)).json()).data;
  expect(String(order.status).toLowerCase()).toBe('cancelled');
  expect(order.cancelReason).toBe(CANCEL_REASON);
  const history = order.history as Array<{ fromStatus: string | null; toStatus: string; reason: string | null; changedBy: { kind: string } }>;
  expect(history.map((entry) => entry.toStatus)).toEqual(['draft', 'cancelled']);
  expect(history[0].changedBy.kind).toBe('storefront');
  expect(history[1]).toMatchObject({ fromStatus: 'draft', reason: CANCEL_REASON, changedBy: { kind: 'user' } });
  expect((await siteOrders('cancelled')).total).toBe(1);
  expect((await siteOrders('draft')).total).toBe(0);
});

test('a store that stops selling takes no more orders: the checkout and the confirmation are 404', async () => {
  const off = await api.patch(`/ycode/api/platform/sites/${store.site.id}/store`, { data: { selling: false } });
  expect(off.status(), await off.text()).toBe(200);
  const refused = await checkout(checkoutBody());
  expect(refused.status()).toBe(404);
  expect((await refused.json()).code).toBe('store_not_found');
  expect((await confirmation(placed.checkout_id)).status()).toBe(404);
  expect((await siteOrders()).total, 'no new order').toBe(1);
});
