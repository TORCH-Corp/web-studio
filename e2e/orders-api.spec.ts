/**
 * Part 2, session W8 "done when": the app can list, read, confirm and cancel
 * the organization's storefront orders.
 *
 * Orders are made the way a buyer makes them, through the checkout of two
 * sites of the catalogue organization (e2e/checkout.spec.ts sets one up the
 * same way), so the join the list does is the real one: Sales' order, the
 * checkout record Web Studio keeps, the site, and the buyer Contact Center
 * made. The platform stub stands in for Sales and Contact Center
 * (e2e/order-services-stub.ts) and records every call; the people are
 * e2e/auth-fixtures.ts' and sign in through the callback with a signed token,
 * so the Sales flag comes from the auth stub the way it does in production:
 *
 *   owner      Web Studio manage_orders all flags, Sales manage_orders all flags
 *   salesless  Web Studio manage_orders all flags, Sales manage_orders r only
 *   viewer     Web Studio manage_orders r (the new default of Member and Viewer)
 *
 * The stub keeps its persons and orders while it runs, so each run uses its
 * own phone numbers and the specs compare counts to what they read before.
 */

import { randomUUID } from 'node:crypto';
import { expect, request, test, type APIRequestContext, type APIResponse } from '@playwright/test';
import { PEOPLE, ORG, claimsFor, type TestPerson } from './auth-fixtures';
import { callback, createSite, signInWithToken, type SiteRecord } from './helpers';
import { BRANCH, CATALOGUE_ORG, CATEGORY, ITEM, SALES_APP_ID, WS_APP_ID } from './platform-fixtures';
import { signTestToken } from './test-keys';

test.describe.configure({ mode: 'serial' });

const RUN = Date.now().toString(36);
const PORT = Number(process.env.E2E_PORT || 3102);
const PLATFORM = `http://127.0.0.1:${Number(process.env.E2E_PLATFORM_PORT || PORT + 3)}`;
const FEE = 2500;

/** Seven digits of this run, so the stub's persons from an earlier run never match. */
const DIGITS = String(Date.now()).slice(-7);
const phone = (prefix: string) => ({ typed: `${prefix} ${DIGITS.slice(0, 3)} ${DIGITS.slice(3)}`, canonical: `964${prefix.slice(1)}${DIGITS}` });
const ALI = { name: 'Ali Hassan', phone: phone('0772') };
const SARA = { name: 'Sara Kareem', phone: phone('0773') };

let baseURL: string;
let owner: APIRequestContext;
let salesless: APIRequestContext;
let viewer: APIRequestContext;
let siteA: SiteRecord;
let siteB: SiteRecord;

interface Placed {
  checkoutId: string;
  id: string;
  code: string;
  site: SiteRecord;
  buyer: typeof ALI;
  total: string;
}
let aliOnA: Placed;
let saraOnA: Placed;
let aliOnB: Placed;

interface Call {
  method: string;
  path: string;
  entityId: string | null;
  body: Record<string, any> | null;
  status: number;
  response: Record<string, any>;
}

async function calls(service: 'contact-center' | 'sales'): Promise<Call[]> {
  const context = await request.newContext();
  try {
    return ((await (await context.get(`${PLATFORM}/__calls?service=${service}`)).json()) as { calls: Call[] }).calls;
  } finally {
    await context.dispose();
  }
}
const since = async (service: 'contact-center' | 'sales', before: Call[]) => (await calls(service)).slice(before.length);

async function control(path: string, data: unknown): Promise<void> {
  const context = await request.newContext();
  try {
    expect((await context.post(`${PLATFORM}${path}`, { data })).status()).toBe(200);
  } finally {
    await context.dispose();
  }
}
const servicesDown = (services: string[]) => control('/__down', { services });

const tokenFor = (person: TestPerson, organization = CATALOGUE_ORG) => signTestToken(claimsFor(person, organization));

async function json(response: APIResponse, status: number) {
  const text = await response.text();
  expect(response.status(), text).toBe(status);
  return JSON.parse(text);
}

const orders = (api: APIRequestContext, query = '') => api.get(`/ycode/api/platform/orders${query ? `?${query}` : ''}`);
const waiting = async (api: APIRequestContext = owner) => ((await json(await api.get('/ycode/api/platform/orders/waiting-count'), 200)).data.count as number);
const detail = async (api: APIRequestContext, id: string) => (await json(await api.get(`/ycode/api/platform/orders/${id}`), 200)).data;

async function placeOrder(site: SiteRecord, buyer: typeof ALI): Promise<Placed> {
  const host = site.hosts[0];
  const visitor = await request.newContext({ baseURL, extraHTTPHeaders: { 'x-forwarded-host': host, origin: `https://${host}` } });
  try {
    const before = await calls('sales');
    const checkoutId = randomUUID();
    const body = {
      checkout_id: checkoutId,
      buyer: { name: buyer.name, phone: buyer.phone.typed, city: 'baghdad', address: 'الكرادة، شارع 62، دار 14', landmark: 'قرب جامع الكرادة', notes: 'اتصلوا قبل الظهر' },
      lines: [{ item_id: ITEM.lamp, quantity: '2' }, { item_id: ITEM.shirtSmallWhite, quantity: 1 }],
      locale: 'ar',
    };
    const answer = await json(await visitor.post('/ycode/api/store/checkout', { data: body }), 201);
    const created = (await since('sales', before)).find((call) => call.method === 'POST' && call.path === '/internal/orders')!;
    return { checkoutId, id: created.response.data.id, code: answer.data.code, site, buyer, total: created.response.data.total };
  } finally {
    await visitor.dispose();
  }
}

test.beforeAll(async ({ baseURL: configured }) => {
  baseURL = configured!;
  await servicesDown([]);
  owner = await signInWithToken(baseURL, tokenFor(PEOPLE.owner));
  salesless = await signInWithToken(baseURL, tokenFor(PEOPLE.salesless));
  viewer = await signInWithToken(baseURL, tokenFor(PEOPLE.viewer));
  for (const [name, slug] of [['Orders Karrada', 'a'], ['Orders Mansour', 'b']]) {
    const site = await createSite(owner, { name: name, slug: `orders-${slug}-${RUN}`, languages: ['ar', 'en'], default_language: 'ar' });
    const patched = await owner.patch(`/ycode/api/platform/sites/${site.id}/store`, {
      data: { branch_id: BRANCH.catalogue, category_ids: [CATEGORY.clothing, CATEGORY.home], delivery_fee: FEE, selling: true },
    });
    expect(patched.status(), await patched.text()).toBe(200);
    if (slug === 'a') siteA = site;
    else siteB = site;
  }
  aliOnA = await placeOrder(siteA, ALI);
  saraOnA = await placeOrder(siteA, SARA);
  aliOnB = await placeOrder(siteB, ALI);
});

test.afterAll(async () => {
  await servicesDown([]);
  await Promise.all([owner, salesless, viewer].map((api) => api?.dispose()));
});

test('sign-in keeps the user\'s Sales flag, and the session answers it', async () => {
  const flag = async (api: APIRequestContext) => (await json(await api.get('/ycode/api/auth/session'), 200)).data.sales_manage_orders_x;
  expect(await flag(owner)).toBe(true);
  expect(await flag(salesless)).toBe(false); // r on Sales' orders, not x
  expect(await flag(viewer)).toBe(false); // no Sales leaf at all
  const anonymous = await request.newContext({ baseURL });
  try {
    expect((await json(await anonymous.get('/ycode/api/auth/session'), 200)).data.sales_manage_orders_x).toBeNull();
  } finally {
    await anonymous.dispose();
  }
  // The renewal the builder asks for carries it too.
  const renewed = await callback(owner, tokenFor(PEOPLE.owner), undefined, { Accept: 'application/json' });
  expect((await json(renewed, 200)).data.sales_manage_orders_x).toBe(true);
  // The app shows confirm and cancel when both flags are true: the Web Studio one is in the session's permissions as before.
  expect((await json(await owner.get('/ycode/api/auth/session'), 200)).data.permissions['webstudio.manage_orders']).toEqual(expect.arrayContaining(['r', 'x']));
  expect((await json(await salesless.get('/ycode/api/auth/session'), 200)).data.permissions['webstudio.manage_orders']).toEqual(expect.arrayContaining(['r', 'x']));
});

test('the list shows the orders of every site with code, site, buyer, total, status and date, newest first', async () => {
  const body = await json(await orders(owner, 'limit=100'), 200);
  expect(body.buyer_error).toBeNull();
  expect(body.total).toBeGreaterThanOrEqual(3);
  const mine = (body.data as any[]).filter((row) => [aliOnA.id, saraOnA.id, aliOnB.id].includes(row.id));
  expect(mine.map((row) => row.id)).toEqual([aliOnB.id, saraOnA.id, aliOnA.id]); // newest first
  expect(mine[0]).toEqual({
    id: aliOnB.id,
    code: aliOnB.code,
    site: { id: siteB.id, name: 'Orders Mansour' },
    buyer: { id: expect.stringMatching(/^[0-9a-f-]{36}$/), name: ALI.name, phone: ALI.phone.canonical },
    total: aliOnB.total,
    currency: 'IQD',
    status: 'draft',
    created_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
  });
  expect(mine[1].site).toEqual({ id: siteA.id, name: 'Orders Karrada' });
  expect(mine[1].buyer).toMatchObject({ name: SARA.name, phone: SARA.phone.canonical });
  // Ali bought on both sites: one Contact Center person.
  expect(mine[0].buyer.id).toBe(mine[2].buyer.id);
  expect(mine[0].buyer.id).not.toBe(mine[1].buyer.id);
});

test('filtered by site, only that site\'s orders; Sales is asked for the storefront source and that site', async () => {
  const before = await calls('sales');
  const body = await json(await orders(owner, `site_id=${siteA.id}`), 200);
  expect((body.data as any[]).map((row) => row.id)).toEqual([saraOnA.id, aliOnA.id]);
  expect(body.total).toBe(2);
  expect(body.next_cursor).toBeNull();
  expect((body.data as any[]).every((row) => row.site.id === siteA.id)).toBe(true);

  const asked = (await since('sales', before)).filter((call) => call.method === 'GET');
  expect(asked).toHaveLength(1);
  const query = new URL(asked[0].path, 'http://stub').searchParams;
  expect(asked[0].entityId).toBe(CATALOGUE_ORG);
  expect(query.getAll('source')).toEqual(['storefront']);
  expect(query.get('sourceReference')).toBe(siteA.id);
  expect(query.get('limit')).toBe('25');

  expect(((await json(await orders(owner, `site_id=${siteB.id}`), 200)).data as any[]).map((row) => row.id)).toEqual([aliOnB.id]);
  expect((await json(await orders(owner, `site_id=${randomUUID()}`), 200)).data).toEqual([]);
});

test('the buyers are looked up once for the page, by their ids', async () => {
  const before = await calls('contact-center');
  await json(await orders(owner, `site_id=${siteA.id}`), 200);
  const lookups = await since('contact-center', before);
  expect(lookups).toHaveLength(1);
  expect(lookups[0]).toMatchObject({ method: 'POST', path: '/api/v1/directory/lookup-ids', entityId: CATALOGUE_ORG, status: 200 });
  expect(lookups[0].body!.ids).toHaveLength(2);
});

test('the search matches the code or the buyer\'s name on the page, and the status filter narrows to a status', async () => {
  const byCode = await json(await orders(owner, `site_id=${siteA.id}&q=${encodeURIComponent(aliOnA.code.toLowerCase())}`), 200);
  expect((byCode.data as any[]).map((row) => row.id)).toEqual([aliOnA.id]);
  const byName = await json(await orders(owner, `q=${encodeURIComponent('sara kar')}&limit=100`), 200);
  expect((byName.data as any[]).map((row) => row.id)).toContain(saraOnA.id);
  expect((byName.data as any[]).every((row) => row.buyer.name?.toLowerCase().includes('sara kar'))).toBe(true);
  expect((await json(await orders(owner, `site_id=${siteA.id}&q=nobody-by-this-name`), 200)).data).toEqual([]);

  const drafts = await json(await orders(owner, `site_id=${siteA.id}&status=draft`), 200);
  expect(drafts.data).toHaveLength(2);
  expect((await json(await orders(owner, `site_id=${siteA.id}&status=confirmed,cancelled`), 200)).data).toEqual([]);
});

test('paging follows Sales\'s cursor; a bad cursor, status, limit or site is refused', async () => {
  const first = await json(await orders(owner, `site_id=${siteA.id}&limit=1`), 200);
  expect((first.data as any[]).map((row) => row.id)).toEqual([saraOnA.id]);
  expect(first.total).toBe(2);
  expect(first.next_cursor).toEqual(expect.any(String));
  const second = await json(await orders(owner, `site_id=${siteA.id}&limit=1&cursor=${encodeURIComponent(first.next_cursor)}`), 200);
  expect((second.data as any[]).map((row) => row.id)).toEqual([aliOnA.id]);
  expect(second.next_cursor).toBeNull();

  expect(await json(await orders(owner, 'cursor=garbage'), 400)).toMatchObject({ code: 'invalid_cursor' });
  for (const query of ['status=shipped', 'limit=0', 'limit=101', 'site_id=not-a-uuid', 'unknown=1']) {
    const refused = await json(await orders(owner, query), 400);
    expect(refused.error, query).toBe('Invalid query');
    expect(refused.details.length, query).toBeGreaterThan(0);
  }
});

test('the waiting count is Sales\'s number of storefront drafts', async () => {
  const before = await calls('sales');
  const count = await waiting();
  expect(count).toBeGreaterThanOrEqual(3);
  const asked = (await since('sales', before)).filter((call) => call.method === 'GET');
  expect(asked).toHaveLength(1);
  const query = new URL(asked[0].path, 'http://stub').searchParams;
  expect(query.getAll('source')).toEqual(['storefront']);
  expect(query.getAll('status')).toEqual(['draft']);
  expect(query.get('limit')).toBe('1');
  expect(count).toBe((await json(await orders(owner, 'status=draft&limit=1'), 200)).total);
});

test('an order\'s detail has the lines with their axes, the address, fee, payment method, notes, history, buyer, site and the deep links', async () => {
  const body = await json(await owner.get(`/ycode/api/platform/orders/${aliOnA.id}`), 200);
  expect(body.buyer_error).toBeNull();
  const order = body.data;
  expect(order).toMatchObject({
    id: aliOnA.id,
    code: aliOnA.code,
    status: 'draft',
    currency: 'IQD',
    site: { id: siteA.id, name: 'Orders Karrada' },
    checkout_id: aliOnA.checkoutId,
    buyer: { name: ALI.name, phone: ALI.phone.canonical },
    delivery_fee: String(FEE),
    total: aliOnA.total,
    payment_method: 'cash_on_delivery',
    delivery_address: { city: 'بغداد', address: 'الكرادة، شارع 62، دار 14', landmark: 'قرب جامع الكرادة', phone: ALI.phone.typed }, // the number as typed
    notes: 'اتصلوا قبل الظهر',
  });
  expect(order.lines).toHaveLength(2);
  const shirt = order.lines.find((line: any) => line.item_id === ITEM.shirtSmallWhite);
  expect(shirt.axes.length).toBe(2); // the variant's size and colour, in both languages
  expect(shirt.axes[0]).toEqual({ specification: { en: expect.any(String), ar: expect.any(String) }, option: { en: expect.any(String), ar: expect.any(String) } });
  expect(order.lines.find((line: any) => line.item_id === ITEM.lamp)).toMatchObject({ axes: [], quantity: '2', unit: { code: 'UOM-000001' } });
  expect(order.history).toEqual([
    { from_status: null, to_status: 'draft', reason: null, changed_by: { id: '00000000-0000-0000-0000-000000000002', kind: 'storefront', name: 'Storefront (Web Studio)' }, changed_at: expect.any(String) },
  ]);
  expect(order.links).toEqual({
    open_in_sales: `torch://app/${SALES_APP_ID}/orders/${aliOnA.id}`,
    open_in_web_studio: `torch://app/${WS_APP_ID}/orders/${aliOnA.id}`,
  });
});

test('an order that does not exist, is not a uuid, or belongs to another organization is not found', async () => {
  expect((await owner.get(`/ycode/api/platform/orders/${randomUUID()}`)).status()).toBe(404);
  expect((await owner.get('/ycode/api/platform/orders/not-a-uuid')).status()).toBe(404);
  // A user of another organization sees none of this organization's orders.
  const stranger = await signInWithToken(baseURL, tokenFor(PEOPLE.owner, ORG));
  try {
    expect((await json(await orders(stranger, 'limit=100'), 200)).data).toEqual([]);
    expect((await stranger.get(`/ycode/api/platform/orders/${aliOnA.id}`)).status()).toBe(404);
    expect((await stranger.post(`/ycode/api/platform/orders/${aliOnA.id}/confirm`)).status()).toBe(404);
  } finally {
    await stranger.dispose();
  }
});

test('a user with both flags confirms an order: Sales is told the acting user, and the history names them', async () => {
  const [before, callsBefore, draft] = [await waiting(), await calls('sales'), await detail(owner, aliOnA.id)];
  expect(draft.status).toBe('draft');

  const confirmed = await json(await owner.post(`/ycode/api/platform/orders/${aliOnA.id}/confirm`), 200);
  expect(confirmed.data).toEqual({ id: aliOnA.id, status: 'confirmed' });

  const posts = (await since('sales', callsBefore)).filter((call) => call.method === 'POST');
  expect(posts).toHaveLength(1);
  expect(posts[0]).toMatchObject({ path: `/internal/orders/${aliOnA.id}/status`, entityId: CATALOGUE_ORG, status: 200 });
  expect(posts[0].body).toEqual({ status: 'confirmed', actingUserId: PEOPLE.owner.sub });

  const after = await detail(owner, aliOnA.id);
  expect(after.status).toBe('confirmed');
  expect(after.history).toHaveLength(2);
  expect(after.history[1]).toEqual({
    from_status: 'draft', to_status: 'confirmed', reason: null, changed_by: { id: PEOPLE.owner.sub, kind: 'user', name: 'Owner Person' }, changed_at: expect.any(String),
  });
  expect(await waiting()).toBe(before - 1);
  expect(((await json(await orders(owner, `site_id=${siteA.id}&status=confirmed`), 200)).data as any[]).map((row) => row.id)).toEqual([aliOnA.id]);
});

test('cancelling needs a reason; with one, Sales cancels and shows it; a cancelled order takes no further status', async () => {
  const cancel = (id: string, data: unknown) => owner.post(`/ycode/api/platform/orders/${id}/cancel`, { data });
  const before = await calls('sales');
  for (const data of [{}, { reason: '   ' }, { reason: 'x'.repeat(501) }, { reason: 'ok', extra: 1 }]) {
    expect((await json(await cancel(saraOnA.id, data), 400)).error, JSON.stringify(data).slice(0, 40)).toBe('Invalid cancellation');
  }
  expect((await owner.post(`/ycode/api/platform/orders/${saraOnA.id}/cancel`, { data: 'not json', headers: { 'content-type': 'application/json' } })).status()).toBe(400);
  expect((await since('sales', before)).filter((call) => call.method === 'POST')).toHaveLength(0); // nothing reached Sales

  const waitingBefore = await waiting();
  const cancelled = await json(await cancel(saraOnA.id, { reason: '  Buyer called to cancel  ' }), 200);
  expect(cancelled.data).toEqual({ id: saraOnA.id, status: 'cancelled' });
  const posts = (await since('sales', before)).filter((call) => call.method === 'POST');
  expect(posts[0].body).toEqual({ status: 'cancelled', reason: 'Buyer called to cancel', actingUserId: PEOPLE.owner.sub });

  const after = await detail(owner, saraOnA.id);
  expect(after.status).toBe('cancelled');
  expect(after.history.at(-1)).toMatchObject({ from_status: 'draft', to_status: 'cancelled', reason: 'Buyer called to cancel', changed_by: { id: PEOPLE.owner.sub, kind: 'user' } });
  expect(await waiting()).toBe(waitingBefore - 1);

  // Sales' rule comes through with its status and code.
  expect(await json(await owner.post(`/ycode/api/platform/orders/${saraOnA.id}/confirm`), 422)).toMatchObject({ code: 'invalid_transition' });
  expect(await json(await cancel(saraOnA.id, { reason: 'again' }), 422)).toMatchObject({ code: 'invalid_transition' });
  expect((await detail(owner, saraOnA.id)).history).toHaveLength(2); // unchanged
  expect((await owner.post(`/ycode/api/platform/orders/${randomUUID()}/confirm`)).status()).toBe(404);
});

test('a user with only the Web Studio flag is refused by Sales: 403 sales_permission_missing, and the order is unchanged', async () => {
  const before = await calls('sales');
  expect((await detail(salesless, aliOnB.id)).status).toBe('draft'); // they can see it: r on Web Studio's leaf

  const confirm = await json(await salesless.post(`/ycode/api/platform/orders/${aliOnB.id}/confirm`), 403);
  expect(confirm).toMatchObject({ code: 'sales_permission_missing', required: 'sales.manage_orders.x' });
  const cancel = await json(await salesless.post(`/ycode/api/platform/orders/${aliOnB.id}/cancel`, { data: { reason: 'no stock' } }), 403);
  expect(cancel.code).toBe('sales_permission_missing');

  // Sales was asked, with this user as the acting user, and said no.
  const posts = (await since('sales', before)).filter((call) => call.method === 'POST');
  expect(posts.map((call) => [call.body!.actingUserId, call.status])).toEqual([[PEOPLE.salesless.sub, 403], [PEOPLE.salesless.sub, 403]]);
  const after = await detail(owner, aliOnB.id);
  expect(after.status).toBe('draft');
  expect(after.history).toHaveLength(1);
});

test('a Viewer reads the orders but is refused confirm and cancel by Web Studio, before Sales is asked', async () => {
  const before = await calls('sales');
  expect((await json(await orders(viewer, `site_id=${siteB.id}`), 200)).data).toHaveLength(1);
  expect((await detail(viewer, aliOnB.id)).id).toBe(aliOnB.id);
  expect(await waiting(viewer)).toBeGreaterThanOrEqual(1);

  const confirm = await json(await viewer.post(`/ycode/api/platform/orders/${aliOnB.id}/confirm`), 403);
  expect(confirm).toEqual({ error: 'Forbidden', required: 'webstudio.manage_orders.x' });
  const cancel = await json(await viewer.post(`/ycode/api/platform/orders/${aliOnB.id}/cancel`, { data: { reason: 'no stock' } }), 403);
  expect(cancel.required).toBe('webstudio.manage_orders.x');
  expect((await since('sales', before)).filter((call) => call.method === 'POST')).toHaveLength(0);
  expect((await detail(owner, aliOnB.id)).status).toBe('draft');
});

test('no session, and a person with no Web Studio leaf, are refused', async () => {
  const anonymous = await request.newContext({ baseURL });
  try {
    for (const path of ['/ycode/api/platform/orders', '/ycode/api/platform/orders/waiting-count', `/ycode/api/platform/orders/${aliOnA.id}`]) {
      expect((await anonymous.get(path)).status(), path).toBe(401);
    }
    expect((await anonymous.post(`/ycode/api/platform/orders/${aliOnA.id}/confirm`)).status()).toBe(401);
    const refused = await callback(anonymous, tokenFor(PEOPLE.nobody));
    expect(refused.status()).toBe(403);
    expect((await anonymous.get('/ycode/api/platform/orders')).status()).toBe(401);
  } finally {
    await anonymous.dispose();
  }
});

test('Contact Center out of reach leaves the orders listed without their buyers\' names; Sales out of reach is 503', async () => {
  try {
    await servicesDown(['contact-center']);
    const list = await json(await orders(owner, `site_id=${siteA.id}`), 200);
    expect(list.buyer_error).toBe('contact_center_unavailable');
    expect((list.data as any[]).map((row) => [row.id, row.buyer.name, row.buyer.phone])).toEqual([[saraOnA.id, null, null], [aliOnA.id, null, null]]);
    expect((list.data as any[])[0].buyer.id).toEqual(expect.any(String));
    const one = await json(await owner.get(`/ycode/api/platform/orders/${aliOnA.id}`), 200);
    expect(one.buyer_error).toBe('contact_center_unavailable');
    expect(one.data.buyer.name).toBeNull();
    expect(one.data.lines).toHaveLength(2);

    await servicesDown(['sales']);
    for (const path of ['/ycode/api/platform/orders', '/ycode/api/platform/orders/waiting-count', `/ycode/api/platform/orders/${aliOnA.id}`]) {
      expect(await json(await owner.get(path), 503), path).toMatchObject({ code: 'sales_unavailable' });
    }
    expect(await json(await owner.post(`/ycode/api/platform/orders/${aliOnB.id}/confirm`), 503)).toMatchObject({ code: 'sales_unavailable' });
  } finally {
    await servicesDown([]);
  }
  expect((await detail(owner, aliOnB.id)).status).toBe('draft');
});

test('the orders of a site that has been deleted stay in the list with the site\'s name', async () => {
  const deleted = await owner.delete(`/ycode/api/platform/sites/${siteB.id}`);
  expect(deleted.ok(), await deleted.text()).toBe(true);
  const body = await json(await orders(owner, `site_id=${siteB.id}`), 200);
  expect(body.data).toHaveLength(1);
  expect(body.data[0].site).toEqual({ id: siteB.id, name: 'Orders Mansour' });
  expect((await detail(owner, aliOnB.id)).checkout_id).toBe(aliOnB.checkoutId);
});
