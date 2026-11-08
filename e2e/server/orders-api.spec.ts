/**
 * Part 2, session W8's Orders API for the app, against the deployed service and
 * the real Sales and Contact Center (session D1, server mode).
 *
 * The spec places one order through the public checkout of a selling site of the
 * test organization, then does what the Tauri app's Orders screens do with the
 * signed-in user's token: list the organization's storefront orders (by site, by
 * status, by code), count the ones waiting, read one with its buyer, lines and
 * history, confirm it and cancel it with a reason, each through Sales's service
 * status route with the acting user. The permission matrix needs several users
 * and stays in the local e2e (e2e/orders-api.spec.ts). The order is cancelled by
 * the spec; the afterAll cancels whatever is still open.
 */

import { expect, request, test, type APIRequestContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { signInWithToken } from '../helpers';
import { accessToken, CANCEL_REASON, cancelOpenOrders, createSellingSite, deleteSite, ensureStoreItem, SALES_URL, STORE_ITEM, TEST_BUYER, visitor, type SellingSite } from './real-services';

test.describe.configure({ mode: 'serial' });

const RUN = Date.now().toString(36);
const REASON = CANCEL_REASON;

let baseURL: string;
let api: APIRequestContext;
let sales: APIRequestContext;
let fixture: { id: string; imageDocumentId: string };
let store: SellingSite;
let checkoutId: string;
let code: string;
let orderId: string;
let waitingBefore: number;

const orders = async (query = '') => {
  const response = await api.get(`/ycode/api/platform/orders?site_id=${store.site.id}${query}`);
  expect(response.status(), await response.text()).toBe(200);
  return (await response.json()) as { data: Array<{ id: string; code: string; status: string; buyer: { id: string | null; name: string | null; phone: string | null } }>; next_cursor: string | null; total: number; buyer_error: string | null };
};
const detail = async () => {
  const response = await api.get(`/ycode/api/platform/orders/${orderId}`);
  expect(response.status(), await response.text()).toBe(200);
  return (await response.json()).data;
};
/**
 * The order's status history as Sales's own user read has it (GET /orders/{id}). The Orders API's `history` is
 * Sales's service read's, `GET /internal/orders/{id}`, which does not carry the history yet: on production it
 * is [] (OPEN_QUESTIONS 38 and 39), so the history is checked here, in Sales.
 */
const salesHistory = async () => {
  const response = await sales.get(`/orders/${orderId}`);
  expect(response.status(), await response.text()).toBe(200);
  return (await response.json()).data.history as Array<{ fromStatus: string | null; toStatus: string; reason: string | null; changedBy: { kind: string; name: string } }>;
};
const waiting = async () => {
  const response = await api.get('/ycode/api/platform/orders/waiting-count');
  expect(response.status(), await response.text()).toBe(200);
  return (await response.json()).data.count as number;
};

test.beforeAll(async ({ baseURL: configured }) => {
  baseURL = configured!;
  const token = await accessToken();
  api = await signInWithToken(baseURL, token);
  sales = await request.newContext({ baseURL: SALES_URL, extraHTTPHeaders: { authorization: `Bearer ${token}` } });
  fixture = await ensureStoreItem(token);
  store = await createSellingSite(api, RUN, { slugPrefix: 'e2e-ord', name: 'E2E orders', deliveryFee: 2500 });

  const shop = await visitor(store.host);
  try {
    checkoutId = randomUUID();
    const placed = await shop.post('/ycode/api/store/checkout', {
      data: {
        checkout_id: checkoutId,
        buyer: { name: TEST_BUYER.name, phone: TEST_BUYER.phone, city: 'basra', address: 'E2E orders street 2', landmark: '', notes: 'Made by the Web Studio server e2e; cancelled by the run.' },
        lines: [{ item_id: fixture.id, quantity: 3 }],
        locale: 'en',
      },
    });
    expect(placed.status(), await placed.text()).toBe(201);
    code = (await placed.json()).data.code as string;
  } finally {
    await shop.dispose();
  }
  const list = await orders();
  expect(list.total).toBe(1);
  orderId = list.data[0].id;
  waitingBefore = await waiting();
});

test.afterAll(async () => {
  await cancelOpenOrders(api, store?.site.id);
  await sales?.dispose();
  await deleteSite(api, store?.site);
  await api?.dispose();
});

test('no session is 401 on every route', async () => {
  const anonymous = await request.newContext({ baseURL });
  try {
    for (const route of ['/ycode/api/platform/orders', `/ycode/api/platform/orders/${orderId}`, '/ycode/api/platform/orders/waiting-count']) {
      expect((await anonymous.get(route)).status(), route).toBe(401);
    }
    for (const route of [`/ycode/api/platform/orders/${orderId}/confirm`, `/ycode/api/platform/orders/${orderId}/cancel`]) {
      expect((await anonymous.post(route, { data: { reason: 'x' } })).status(), route).toBe(401);
    }
  } finally {
    await anonymous.dispose();
  }
});

test('the list shows the order as a draft, waiting, with its buyer from Contact Center; status, code and site narrow it; a bad query is 400', async () => {
  const list = await orders();
  expect(list.buyer_error).toBeNull();
  expect(list.data).toHaveLength(1);
  expect(list.data[0]).toMatchObject({ id: orderId, code, status: 'draft', buyer: { name: TEST_BUYER.name } });
  // Contact Center holds the phone in its canonical form.
  expect(list.data[0].buyer.phone).toContain(TEST_BUYER.canonical.slice(3));

  expect((await orders('&status=draft')).total).toBe(1);
  expect((await orders('&status=confirmed,cancelled')).total).toBe(0);
  expect((await orders(`&q=${encodeURIComponent(code)}`)).data).toHaveLength(1);
  expect((await orders(`&q=${encodeURIComponent(`nobody-${RUN}`)}`)).data).toHaveLength(0);
  const elsewhere = await api.get(`/ycode/api/platform/orders?site_id=${randomUUID()}`);
  expect(elsewhere.status()).toBe(200);
  expect((await elsewhere.json()).total).toBe(0);

  // The order is waiting for confirmation, and the count (taken once the order existed) says so.
  expect(waitingBefore).toBeGreaterThanOrEqual(1);

  expect((await api.get('/ycode/api/platform/orders?status=shipped')).status()).toBe(400);
  expect((await api.get('/ycode/api/platform/orders?limit=0')).status()).toBe(400);
  const cursor = await api.get('/ycode/api/platform/orders?cursor=not-a-cursor');
  expect(cursor.status()).toBe(400);
});

test('one order: its buyer, lines, amounts, address, history and the two deep links; an unknown order is 404', async () => {
  const order = await detail();
  expect(order).toMatchObject({
    id: orderId,
    code,
    status: 'draft',
    currency: 'IQD',
    checkout_id: checkoutId,
    payment_method: 'cash_on_delivery',
    buyer: { name: TEST_BUYER.name },
    site: { id: store.site.id },
  });
  expect(order.lines).toHaveLength(1);
  expect(order.lines[0]).toMatchObject({ item_id: fixture.id, sku: STORE_ITEM.sku, axes: [] });
  expect(order.lines[0].name.en).toBe(STORE_ITEM.name);
  expect(Number(order.lines[0].quantity)).toBe(3);
  expect(Number(order.lines[0].unit_price)).toBe(STORE_ITEM.price);
  expect(Number(order.lines[0].line_total)).toBe(75000);
  expect(Number(order.subtotal)).toBe(75000);
  expect(Number(order.delivery_fee)).toBe(2500);
  expect(Number(order.total)).toBe(77500);
  expect(order.delivery_address).toMatchObject({ city: 'Basra', address: 'E2E orders street 2', phone: TEST_BUYER.phone });
  expect(Array.isArray(order.history)).toBe(true);
  const created = await salesHistory();
  expect(created).toHaveLength(1);
  expect(created[0]).toMatchObject({ fromStatus: null, toStatus: 'draft', changedBy: { kind: 'storefront' } });
  expect(order.links.open_in_sales).toMatch(new RegExp(`^torch://app/[0-9a-f-]{36}/orders/${orderId}$`));
  expect(order.links.open_in_web_studio).toMatch(new RegExp(`^torch://app/[0-9a-f-]{36}/orders/${orderId}$`));

  const unknown = await api.get(`/ycode/api/platform/orders/${randomUUID()}`);
  expect(unknown.status()).toBe(404);
});

test('confirm moves the draft to confirmed for the signed-in user, the history names them, and the waiting count drops', async () => {
  const confirmed = await api.post(`/ycode/api/platform/orders/${orderId}/confirm`);
  expect(confirmed.status(), await confirmed.text()).toBe(200);
  expect((await confirmed.json()).data).toEqual({ id: orderId, status: 'confirmed' });

  const order = await detail();
  expect(order.status).toBe('confirmed');
  const history = await salesHistory();
  expect(history.map((entry) => entry.toStatus)).toEqual(['draft', 'confirmed']);
  expect(history[1]).toMatchObject({ fromStatus: 'draft', changedBy: { kind: 'user' } });
  expect(history[1].changedBy.name).toBeTruthy();
  expect((await orders('&status=confirmed')).total).toBe(1);
  expect(await waiting()).toBe(waitingBefore - 1);

  // Confirming a confirmed order is a refusal of the order's own rule, not a server error.
  const again = await api.post(`/ycode/api/platform/orders/${orderId}/confirm`);
  expect([409, 422], await again.text()).toContain(again.status());
});

test('cancel needs a reason, moves the confirmed order to cancelled, and shows the reason to everyone', async () => {
  for (const body of [{}, { reason: '' }, { reason: '   ' }, { reason: 'x'.repeat(501) }, { reason: 'ok', extra: 1 }]) {
    const refused = await api.post(`/ycode/api/platform/orders/${orderId}/cancel`, { data: body });
    expect(refused.status(), JSON.stringify(body).slice(0, 40)).toBe(400);
  }
  expect((await detail()).status, 'a refused cancel changed nothing').toBe('confirmed');

  const cancelled = await api.post(`/ycode/api/platform/orders/${orderId}/cancel`, { data: { reason: REASON } });
  expect(cancelled.status(), await cancelled.text()).toBe(200);
  expect((await cancelled.json()).data).toEqual({ id: orderId, status: 'cancelled' });

  const order = await detail();
  expect(order.status).toBe('cancelled');
  const history = await salesHistory();
  expect(history.map((entry) => entry.toStatus)).toEqual(['draft', 'confirmed', 'cancelled']);
  expect(history[2]).toMatchObject({ fromStatus: 'confirmed', reason: REASON, changedBy: { kind: 'user' } });
  expect((await orders('&status=cancelled')).total).toBe(1);
  expect((await orders('&status=draft,confirmed')).total).toBe(0);

  const again = await api.post(`/ycode/api/platform/orders/${orderId}/cancel`, { data: { reason: REASON } });
  expect([409, 422], await again.text()).toContain(again.status());
});

test('an order of another organization or an unknown one cannot be confirmed or cancelled: 404', async () => {
  const id = randomUUID();
  expect((await api.post(`/ycode/api/platform/orders/${id}/confirm`)).status()).toBe(404);
  expect((await api.post(`/ycode/api/platform/orders/${id}/cancel`, { data: { reason: REASON } })).status()).toBe(404);
});
