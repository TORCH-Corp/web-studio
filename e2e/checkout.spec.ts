/**
 * Part 2, session W3 "done when": a buyer's checkout becomes one Contact
 * Center person and one Sales order, once.
 *
 * The anonymous checkout and confirmation routes on a site's own host
 * (`x-forwarded-host`, as nginx forwards it, and the site's own Origin), with
 * the platform stub standing in for Product & Services and Organization Setup
 * (the catalogue organization of e2e/platform-fixtures.ts, as catalogue.spec.ts
 * reads it) and for Contact Center and Sales (e2e/order-services-stub.ts),
 * which record every call. Sales's service create is SL2's contract as the
 * session plan defines it (amended 8 Nov 2026: the typed phone on the address,
 * the refused item ids on a 422).
 *
 * The stub keeps its persons and orders while it runs, so each run uses its
 * own phone numbers and checkout ids. A change to the store settings forgets
 * the site's 60-second catalogue: that is how a spec makes the next checkout
 * read the stubs again.
 */

import { randomUUID } from 'node:crypto';
import { expect, request, test, type APIRequestContext, type APIResponse } from '@playwright/test';
import { createSite, openSite, signIn, type SiteRecord } from './helpers';
import { BRANCH, CATALOGUE_ORG, CATEGORY, ITEM } from './platform-fixtures';

test.describe.configure({ mode: 'serial' });

const RUN = Date.now().toString(36);
const PORT = Number(process.env.E2E_PORT || 3102);
const PLATFORM = `http://127.0.0.1:${Number(process.env.E2E_PLATFORM_PORT || PORT + 3)}`;
const OWNER = { sub: '47474747-4747-4747-8747-474747474747', email: 'owner-checkout@example.com', name: 'Checkout Owner', org: CATALOGUE_ORG };

/** Seven digits of this run, so the stub's persons from an earlier run never match. */
const DIGITS = String(Date.now()).slice(-7);
const phone = (prefix: string) => ({ typed: `${prefix} ${DIGITS.slice(0, 3)} ${DIGITS.slice(3)}`, canonical: `964${prefix.slice(1)}${DIGITS}` });
const BUYER_PHONE = phone('0770');
const SECOND_PHONE = phone('0771');

const PIECE = { code: 'UOM-000001', name: 'Piece' };
const ADDRESS = 'الكرادة، شارع 62، دار 14';
const LANDMARK = 'قرب جامع الكرادة';
const NOTES = 'اتصلوا قبل الظهر';

let baseURL: string;
let owner: APIRequestContext;
let visitor: APIRequestContext;
let site: SiteRecord;
let fee = 2500;
const feeText = () => `${fee}.00`;

interface Call {
  method: string;
  path: string;
  entityId: string | null;
  body: Record<string, any> | null;
  status: number;
  response: Record<string, any>;
}

async function control(path: string, data: unknown): Promise<void> {
  const context = await request.newContext();
  try {
    expect((await context.post(`${PLATFORM}${path}`, { data })).status()).toBe(200);
  } finally {
    await context.dispose();
  }
}
const servicesDown = (services: string[]) => control('/__down', { services });
const rate = (found: boolean) => control('/__rate', { found });
const salesDelay = (ms: number) => control('/__sales/delay', { ms });
const salesRefuse = (code: string, items: string[]) => control('/__sales/refuse', { code, items });

async function calls(service: 'contact-center' | 'sales'): Promise<Call[]> {
  const context = await request.newContext();
  try {
    return ((await (await context.get(`${PLATFORM}/__calls?service=${service}`)).json()) as { calls: Call[] }).calls;
  } finally {
    await context.dispose();
  }
}
/** The calls of a service made since `before` was read. */
const since = async (service: 'contact-center' | 'sales', before: Call[]) => (await calls(service)).slice(before.length);

async function patchStore(data: Record<string, unknown>): Promise<void> {
  const response = await owner.patch(`/ycode/api/platform/sites/${site.id}/store`, { data });
  expect(response.status(), await response.text()).toBe(200);
}
/** Any change to the store settings: the next checkout reads the catalogue again. */
const forgetCatalogue = () => patchStore({ delivery_fee: (fee += 250) });

function checkoutBody(overrides: { buyer?: Record<string, unknown>; [key: string]: unknown } = {}) {
  const { buyer, ...rest } = overrides;
  return {
    checkout_id: randomUUID(),
    buyer: { name: 'علي حسن', phone: BUYER_PHONE.typed, city: 'baghdad', address: ADDRESS, landmark: LANDMARK, notes: NOTES, ...buyer },
    lines: [{ item_id: ITEM.lamp, quantity: '2' }, { item_id: ITEM.shirtSmallWhite, quantity: 1 }],
    locale: 'ar',
    ...rest,
  };
}

const checkout = (body: unknown, context: APIRequestContext = visitor, headers: Record<string, string> = {}) =>
  context.post('/ycode/api/store/checkout', { data: body, headers });

async function json(response: APIResponse, status: number) {
  const text = await response.text();
  expect(response.status(), text).toBe(status);
  return JSON.parse(text);
}

const confirmation = (checkoutId: string, context: APIRequestContext = visitor) => context.get(`/ycode/api/store/orders/${checkoutId}`);

/**
 * The site's form-spam setting, which the checkout's rate limit reads. Next
 * fills a missing x-forwarded-for with the socket's address, so every request
 * of this spec counts as 127.0.0.1: the spec runs with a high limit and lowers
 * it in its own test.
 */
async function spamSetting(rateLimitMaxSubmissions: number): Promise<void> {
  const response = await owner.put('/ycode/api/settings/form_spam_protection', {
    data: { value: { enabled: true, rateLimitEnabled: true, rateLimitMaxSubmissions, allowExternalSubmissions: false } },
  });
  expect(response.status(), await response.text()).toBe(200);
}

test.beforeAll(async ({ baseURL: configured }) => {
  baseURL = configured!;
  await servicesDown([]);
  await rate(true);
  await salesDelay(0);
  owner = await signIn(baseURL, OWNER);
  site = await createSite(owner, { name: 'Karrada Store', slug: `checkout-${RUN}`, languages: ['ar', 'en'], default_language: 'ar' });
  const host = site.hosts[0];
  visitor = await request.newContext({ baseURL, extraHTTPHeaders: { 'x-forwarded-host': host, origin: `https://${host}` } });
  await patchStore({ branch_id: BRANCH.catalogue, category_ids: [CATEGORY.clothing, CATEGORY.home], delivery_fee: fee, selling: true });
  expect((await openSite(owner, site.id)).status()).toBe(303);
  await spamSetting(1000);
});

test.afterAll(async () => {
  await servicesDown([]);
  await rate(true);
  await salesDelay(0);
  await visitor?.dispose();
  await owner?.dispose();
});

let placed: { checkout_id: string; code: string };
let personId: string;

test('a valid checkout creates one person and one order, and answers the order\'s code', async () => {
  const [cc, sales] = [await calls('contact-center'), await calls('sales')];
  const body = checkoutBody();
  const answer = await json(await checkout(body), 201);
  expect(answer.data).toEqual({ checkout_id: body.checkout_id, code: expect.stringMatching(/^SO-2026-\d{4}$/) });
  placed = answer.data;

  const people = await since('contact-center', cc);
  expect(people).toHaveLength(1);
  expect(people[0]).toMatchObject({ method: 'POST', path: '/api/v1/internal/persons/find-or-create', entityId: CATALOGUE_ORG, status: 201 });
  // The canonical number, 964 and the national digits, whatever was typed.
  expect(people[0].body).toEqual({ name: 'علي حسن', phone: BUYER_PHONE.canonical, origin: 'storefront' });
  personId = people[0].response.person_id;

  const created = await since('sales', sales);
  expect(created).toHaveLength(1);
  expect(created[0]).toMatchObject({ method: 'POST', path: '/internal/orders', entityId: CATALOGUE_ORG, status: 201 });
  // No price is sent: Sales prices the lines. The city in the page's language, the phone as typed.
  expect(created[0].body).toEqual({
    source: 'storefront',
    sourceReference: site.id,
    checkoutId: body.checkout_id,
    customer: { kind: 'PERSON', id: personId },
    branchId: BRANCH.catalogue,
    currency: 'IQD',
    lines: [{ itemId: ITEM.lamp, quantity: '2' }, { itemId: ITEM.shirtSmallWhite, quantity: '1' }],
    deliveryFee: feeText(),
    paymentMethod: 'cash_on_delivery',
    deliveryAddress: { city: 'بغداد', address: ADDRESS, landmark: LANDMARK, phone: BUYER_PHONE.typed },
    notes: NOTES,
  });
});

test('the same checkout again answers the same code, with no call to either service', async () => {
  const [cc, sales] = [await calls('contact-center'), await calls('sales')];
  const again = await json(await checkout(checkoutBody({ checkout_id: placed.checkout_id })), 200);
  expect(again.data).toEqual(placed);
  // Even with another body: a checkout that has its order is answered by it.
  const changed = await json(await checkout(checkoutBody({ checkout_id: placed.checkout_id, lines: [{ item_id: ITEM.shirt, quantity: '1' }] })), 200);
  expect(changed.data).toEqual(placed);
  expect(await since('contact-center', cc)).toHaveLength(0);
  expect(await since('sales', sales)).toHaveLength(0);
});

test('the confirmation read returns the order\'s lines with their axes, the fee, the total, the payment method and the typed phone', async () => {
  const body = await json(await confirmation(placed.checkout_id), 200);
  expect(body.data).toEqual({
    checkout_id: placed.checkout_id,
    code: placed.code,
    currency: 'IQD',
    lines: [
      { item_id: ITEM.lamp, sku: 'LMP-001', name: 'Desk lamp', name_ar: 'مصباح مكتب', axes: [], unit: PIECE, quantity: '2', unit_price: '25000', line_total: '50000' },
      {
        item_id: ITEM.shirtSmallWhite, sku: 'SHT-001-S-WHT', name: 'Linen shirt - Small / White', name_ar: null,
        axes: [
          { name: 'Size', name_ar: 'المقاس', option: 'Small', option_ar: 'صغير' },
          { name: 'Colour', name_ar: 'اللون', option: 'White', option_ar: 'أبيض' },
        ],
        unit: PIECE, quantity: '1', unit_price: '35000', line_total: '35000',
      },
    ],
    subtotal: '85000',
    delivery_fee: String(fee),
    total: String(85000 + fee),
    payment_method: 'cash_on_delivery',
    phone: BUYER_PHONE.typed,
  });
  // Nothing else of the buyer: no name, no address.
  expect(JSON.stringify(body)).not.toContain('علي حسن');
  expect(JSON.stringify(body)).not.toContain(ADDRESS);
});

test('the confirmation read is 404 for an unknown checkout, a malformed id, and another site\'s checkout', async () => {
  expect((await json(await confirmation(randomUUID()), 404)).code).toBe('order_not_found');
  expect((await json(await confirmation('not-a-uuid'), 404)).code).toBe('order_not_found');
  const other = await createSite(owner, { name: 'Second Store', slug: `checkout-two-${RUN}`, languages: ['ar'], default_language: 'ar' });
  const response = await owner.patch(`/ycode/api/platform/sites/${other.id}/store`, { data: { branch_id: BRANCH.catalogue, selling: true } });
  expect(response.status(), await response.text()).toBe(200);
  const elsewhere = await request.newContext({ baseURL, extraHTTPHeaders: { 'x-forwarded-host': other.hosts[0] } });
  try {
    expect((await json(await confirmation(placed.checkout_id, elsewhere), 404)).code).toBe('order_not_found');
  } finally {
    await elsewhere.dispose();
  }
});

test('two concurrent posts with one checkout id make one order', async () => {
  const [cc, sales] = [await calls('contact-center'), await calls('sales')];
  await salesDelay(400);
  try {
    const body = checkoutBody({ lines: [{ item_id: ITEM.lamp, quantity: '1' }] });
    const [first, second] = await Promise.all([checkout(body), checkout(body)]);
    const codes = await Promise.all([first, second].map(async (response) => {
      expect([200, 201], await response.text()).toContain(response.status());
      return (await response.json()).data.code;
    }));
    expect(codes[0]).toMatch(/^SO-/);
    expect(codes[1]).toBe(codes[0]);
  } finally {
    await salesDelay(0);
  }
  expect((await since('contact-center', cc)).filter((call) => call.status < 300)).toHaveLength(1);
  expect((await since('sales', sales)).filter((call) => call.path === '/internal/orders')).toHaveLength(1);
});

test('an ineligible line answers 422 naming each item, in the page\'s language, and nothing is called', async () => {
  const [cc, sales] = [await calls('contact-center'), await calls('sales')];
  const body = checkoutBody({
    lines: [
      { item_id: ITEM.lamp, quantity: '1' },
      { item_id: ITEM.shirtMediumWhite, quantity: '1' }, // discontinued
      { item_id: ITEM.shirt, quantity: '1' }, // the product, not a variant
      { item_id: ITEM.sample, quantity: '1' }, // priced 0
      { item_id: ITEM.chair, quantity: '1' }, // its ECOMMERCE channel off
    ],
  });
  const answer = await json(await checkout(body), 422);
  expect(answer.code).toBe('item_unavailable');
  expect(answer.items).toEqual([
    { item_id: ITEM.shirtMediumWhite, name: 'قميص كتان — المقاس: وسط، اللون: أبيض', reason: 'inactive' },
    { item_id: ITEM.shirt, name: 'قميص كتان', reason: 'parent' },
    { item_id: ITEM.sample, name: null, reason: 'not_on_sale' },
    { item_id: ITEM.chair, name: null, reason: 'not_on_sale' },
  ]);
  expect(await since('contact-center', cc)).toHaveLength(0);
  expect(await since('sales', sales)).toHaveLength(0);
  expect((await json(await confirmation(body.checkout_id), 404)).code).toBe('order_not_found');
});

test('a variant priced in the other currency, on a day with no rate, is unavailable with reason no_rate', async () => {
  await rate(false);
  await forgetCatalogue();
  try {
    const answer = await json(await checkout(checkoutBody({ locale: 'en', lines: [{ item_id: ITEM.shirtSmallBlue, quantity: '1' }] })), 422);
    expect(answer.items).toEqual([{ item_id: ITEM.shirtSmallBlue, name: 'Linen shirt — Size: Small, Colour: Blue', reason: 'no_rate' }]);
  } finally {
    await rate(true);
    await forgetCatalogue();
  }
});

test('an item Sales refuses (changed within the catalogue\'s minute) answers 422 naming it, and nothing is stored', async () => {
  const [cc, sales] = [await calls('contact-center'), await calls('sales')];
  await salesRefuse('item_inactive', [ITEM.lamp]);
  const body = checkoutBody({ locale: 'en' });
  const answer = await json(await checkout(body), 422);
  expect(answer).toMatchObject({ code: 'item_unavailable', items: [{ item_id: ITEM.lamp, name: 'Desk lamp', reason: 'inactive' }] });
  // The person was found (not made again); Sales was asked once.
  expect((await since('contact-center', cc)).map((call) => [call.status, call.response.person_id])).toEqual([[200, personId]]);
  expect((await since('sales', sales)).map((call) => call.status)).toEqual([422]);
  expect((await json(await confirmation(body.checkout_id), 404)).code).toBe('order_not_found');
});

test('a six-digit phone and a city not in the list answer field errors in Arabic on an Arabic page, and nothing is called', async () => {
  const [cc, sales] = [await calls('contact-center'), await calls('sales')];
  const answer = await json(await checkout(checkoutBody({ buyer: { phone: '123456', city: 'paris' } })), 400);
  expect(answer).toEqual({
    error: 'Some fields need correcting',
    code: 'invalid_checkout',
    fields: {
      'buyer.phone': 'أدخل رقم هاتف محمول عراقي، مثل 0770 123 4567 أو ‎+964 770 123 4567.',
      'buyer.city': 'اختر مدينة التوصيل.',
    },
  });
  const english = await json(await checkout(checkoutBody({ locale: 'en', buyer: { name: 'A', address: 'Home' } })), 400);
  expect(english.fields).toEqual({ 'buyer.name': 'Enter your full name.', 'buyer.address': 'Enter your delivery address: area, street and house.' });
  // A key the page never sends is refused, not dropped.
  expect(await json(await checkout({ ...checkoutBody(), lines: [{ item_id: ITEM.lamp, quantity: '1', unit_price: '1' }] }), 400)).toEqual({
    error: 'Unknown field lines.0.unit_price',
    code: 'invalid_body',
  });
  expect(await since('contact-center', cc)).toHaveLength(0);
  expect(await since('sales', sales)).toHaveLength(0);
});

test('with Sales down the answer is 503 and nothing is stored; the person made stays, and the retry finds it', async () => {
  const [cc, sales] = [await calls('contact-center'), await calls('sales')];
  const body = checkoutBody({ buyer: { phone: SECOND_PHONE.typed } });
  await servicesDown(['sales']);
  try {
    expect(await json(await checkout(body), 503)).toEqual({ error: 'The order cannot be placed right now', code: 'service_unavailable' });
    expect((await json(await confirmation(body.checkout_id), 404)).code).toBe('order_not_found');
  } finally {
    await servicesDown([]);
  }
  const retry = await json(await checkout(body), 201);
  expect(retry.data.code).toMatch(/^SO-/);
  const people = await since('contact-center', cc);
  expect(people.map((call) => [call.status, call.body?.phone])).toEqual([[201, SECOND_PHONE.canonical], [200, SECOND_PHONE.canonical]]);
  expect(people[1].response.person_id).toBe(people[0].response.person_id);
  const orders = await since('sales', sales);
  expect(orders.map((call) => call.status)).toEqual([503, 201]);
  expect(orders[1].body?.customer).toEqual({ kind: 'PERSON', id: people[0].response.person_id });
  expect((await json(await confirmation(body.checkout_id), 200)).data.code).toBe(retry.data.code);
});

test('with Contact Center down the answer is 503 and Sales is never called', async () => {
  const sales = await calls('sales');
  await servicesDown(['contact-center']);
  try {
    expect((await json(await checkout(checkoutBody()), 503)).code).toBe('service_unavailable');
  } finally {
    await servicesDown([]);
  }
  expect(await since('sales', sales)).toHaveLength(0);
});

test('with Sales down the confirmation read answers 503', async () => {
  await servicesDown(['sales']);
  try {
    expect((await json(await confirmation(placed.checkout_id), 503)).code).toBe('service_unavailable');
  } finally {
    await servicesDown([]);
  }
});

test('a USD store on a day with no rate answers 503 before Contact Center; with the rate it orders in USD', async () => {
  const [cc, sales] = [await calls('contact-center'), await calls('sales')];
  await rate(false);
  await patchStore({ currency: 'USD', delivery_fee: 3 });
  try {
    const lines = [{ item_id: ITEM.shirtSmallBlue, quantity: '1' }]; // priced in USD: buyable on a USD store with no rate
    expect((await json(await checkout(checkoutBody({ lines })), 503)).code).toBe('service_unavailable');
    expect(await since('contact-center', cc)).toHaveLength(0);
    expect(await since('sales', sales)).toHaveLength(0);

    await rate(true);
    await patchStore({ delivery_fee: 4 });
    const body = checkoutBody({ lines: [...lines, { item_id: ITEM.shirtSmallWhite, quantity: '1' }] });
    await json(await checkout(body), 201);
    const created = (await since('sales', sales)).filter((call) => call.path === '/internal/orders');
    expect(created.map((call) => [call.status, call.body?.currency, call.body?.deliveryFee])).toEqual([[201, 'USD', '4.00']]);
    const order = (await json(await confirmation(body.checkout_id), 200)).data;
    // 20 USD, and 35000 IQD at 1520 IQD per USD.
    expect([order.currency, order.lines.map((line: { unit_price: string }) => line.unit_price), order.delivery_fee, order.total]).toEqual(['USD', ['20.00', '23.03'], '4.00', '47.03']);
  } finally {
    await rate(true);
    await patchStore({ currency: 'IQD', delivery_fee: fee });
  }
});

test('a cross-origin post is 403, and a filled honeypot answers like a success with no order and no call', async () => {
  const [cc, sales] = [await calls('contact-center'), await calls('sales')];
  const foreign = await request.newContext({ baseURL, extraHTTPHeaders: { 'x-forwarded-host': site.hosts[0], origin: 'https://shop.example.com' } });
  const bare = await request.newContext({ baseURL, extraHTTPHeaders: { 'x-forwarded-host': site.hosts[0] } });
  try {
    expect((await json(await checkout(checkoutBody(), foreign), 403)).code).toBe('cross_origin');
    expect((await json(await checkout(checkoutBody(), bare), 403)).code).toBe('cross_origin');
  } finally {
    await foreign.dispose();
    await bare.dispose();
  }
  const spam = checkoutBody({ ycode_hp: 'https://cheap-pills.example' });
  expect(await json(await checkout(spam), 201)).toEqual({ data: { checkout_id: spam.checkout_id, code: null } });
  expect((await json(await confirmation(spam.checkout_id), 404)).code).toBe('order_not_found');
  expect(await since('contact-center', cc)).toHaveLength(0);
  expect(await since('sales', sales)).toHaveLength(0);
});

test('the rate limit counts the site\'s checkouts from one IP that reached Contact Center, with the site\'s own setting', async () => {
  await spamSetting(2);
  try {
    const ip = { 'x-forwarded-for': `203.0.113.${(Date.now() % 200) + 1}` };
    // Refused bodies do not count.
    for (let i = 0; i < 3; i++) await json(await checkout(checkoutBody({ buyer: { phone: '123' } }), visitor, ip), 400);
    await json(await checkout(checkoutBody(), visitor, ip), 201);
    await json(await checkout(checkoutBody(), visitor, ip), 201);
    expect((await json(await checkout(checkoutBody(), visitor, ip), 429)).code).toBe('rate_limited');
    // Another IP has its own count.
    await json(await checkout(checkoutBody(), visitor, { 'x-forwarded-for': '198.51.100.9' }), 201);
  } finally {
    await spamSetting(1000);
  }
});

test('a checkout tried again after Sales failed is counted once against the rate limit', async () => {
  await spamSetting(2);
  try {
    const ip = { 'x-forwarded-for': `192.0.2.${(Date.now() % 200) + 1}` };
    const retried = checkoutBody();
    await servicesDown(['sales']);
    try {
      // The design's "Try again" sends the same checkout: each reaches Contact Center, one is counted.
      for (let i = 0; i < 3; i++) expect((await json(await checkout(retried, visitor, ip), 503)).code).toBe('service_unavailable');
    } finally {
      await servicesDown([]);
    }
    await json(await checkout(retried, visitor, ip), 201);
    await json(await checkout(checkoutBody(), visitor, ip), 201);
    expect((await json(await checkout(checkoutBody(), visitor, ip), 429)).code).toBe('rate_limited');
  } finally {
    await spamSetting(1000);
  }
});

test('on the builder host, and on a store that does not sell, both routes answer 404', async () => {
  const builder = await request.newContext({ baseURL });
  try {
    expect((await json(await checkout(checkoutBody(), builder), 404)).code).toBe('store_not_found');
    expect((await json(await confirmation(placed.checkout_id, builder), 404)).code).toBe('store_not_found');
  } finally {
    await builder.dispose();
  }
  await patchStore({ selling: false });
  try {
    expect((await json(await checkout(checkoutBody()), 404)).code).toBe('store_not_found');
    expect((await json(await confirmation(placed.checkout_id), 404)).code).toBe('store_not_found');
  } finally {
    await patchStore({ selling: true });
  }
});
