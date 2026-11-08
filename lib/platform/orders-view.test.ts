import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buyerOf, matchesQuery, orderDetailView, orderLinks, orderRow, parseCancelBody, parseOrdersQuery } from './orders-view';
import type { OrderSummary, StorefrontOrder } from './sales';

const SITE = '5a5a5a5a-5a5a-4a5a-8a5a-5a5a5a5a5a5a';
const ORDER = '2c2c2c2c-2c2c-4c2c-8c2c-2c2c2c2c2c2c';
const PERSON = '1b1b1b1b-1b1b-4b1b-8b1b-1b1b1b1b1b1b';
const q = (search: string) => new URLSearchParams(search);

test('the list query: defaults, a site, statuses repeated or comma-separated, a search, a cursor and a limit', () => {
  assert.deepEqual(parseOrdersQuery(q('')), { query: { limit: 25 }, errors: null });
  const full = parseOrdersQuery(q(`site_id=${SITE.toUpperCase()}&status=draft&status=confirmed,draft&q=%20SO-2026%20&cursor=abc&limit=100`));
  assert.deepEqual(full, { query: { siteId: SITE, status: ['draft', 'confirmed'], q: 'SO-2026', cursor: 'abc', limit: 100 }, errors: null });
  assert.deepEqual(parseOrdersQuery(q('q=%20%20&status=')), { query: { limit: 25 }, errors: null });
});

test('the list query refuses what Sales would not take, naming the parameter', () => {
  for (const [search, field] of [
    ['site_id=not-a-uuid', 'site_id'],
    ['status=shipped', 'status'],
    ['status=draft,shipped', 'status'],
    ['limit=0', 'limit'],
    ['limit=101', 'limit'],
    ['limit=ten', 'limit'],
    ['limit=2.5', 'limit'],
    [`q=${'x'.repeat(101)}`, 'q'],
    [`cursor=${'x'.repeat(1001)}`, 'cursor'],
    ['siteid=abc', 'siteid'],
  ] as const) {
    const result = parseOrdersQuery(q(search));
    assert.equal(result.query, null, search);
    assert.match(result.errors!.join('; '), new RegExp(field), search);
  }
});

test('a cancel needs a reason of 1 to 500 characters after trimming, and nothing else', () => {
  assert.deepEqual(parseCancelBody({ reason: '  Buyer called to cancel ' }), { reason: 'Buyer called to cancel', errors: null });
  assert.deepEqual(parseCancelBody({ reason: 'x'.repeat(500) }).errors, null);
  for (const body of [null, undefined, 'text', [], {}, { reason: '' }, { reason: '   ' }, { reason: 7 }, { reason: 'x'.repeat(501) }, { reason: 'ok', note: 'extra' }]) {
    const result = parseCancelBody(body);
    assert.equal(result.reason, null, JSON.stringify(body));
    assert.ok(result.errors!.length > 0, JSON.stringify(body));
  }
});

test('the deep links open the order in Sales and in Web Studio, and are null without the app\'s catalogue id', () => {
  assert.deepEqual(orderLinks(ORDER, { SALES_APP_ID: ' sales-app ', WS_APP_ID: 'ws-app' }), {
    open_in_sales: `torch://app/sales-app/orders/${ORDER}`,
    open_in_web_studio: `torch://app/ws-app/orders/${ORDER}`,
  });
  assert.deepEqual(orderLinks(ORDER, { WS_APP_ID: 'ws-app' }), { open_in_sales: null, open_in_web_studio: `torch://app/ws-app/orders/${ORDER}` });
  assert.deepEqual(orderLinks(ORDER, { SALES_APP_ID: '  ' }), { open_in_sales: null, open_in_web_studio: null });
});

const SUMMARY: OrderSummary = { id: ORDER, code: 'SO-2026-0142', status: 'draft', customerId: PERSON, currency: 'IQD', total: '52500', sourceReference: SITE, createdAt: '2026-11-21T08:00:00.000Z' };

test('a row has the code, the site, the buyer, the total and currency, the status and the date', () => {
  const buyer = buyerOf(PERSON, new Map([[PERSON, { id: PERSON, name: 'علي حسن', phone: '9647701234567', archived: false }]]));
  assert.deepEqual(buyer, { id: PERSON, name: 'علي حسن', phone: '9647701234567' });
  assert.deepEqual(orderRow(SUMMARY, { id: SITE, name: 'Karrada Store' }, buyer), {
    id: ORDER,
    code: 'SO-2026-0142',
    site: { id: SITE, name: 'Karrada Store' },
    buyer,
    total: '52500',
    currency: 'IQD',
    status: 'draft',
    created_at: '2026-11-21T08:00:00.000Z',
  });
});

test('a buyer Contact Center does not have, or cannot be asked about, has an id and no name or phone', () => {
  assert.deepEqual(buyerOf(PERSON, new Map()), { id: PERSON, name: null, phone: null });
  assert.deepEqual(buyerOf(PERSON, null), { id: PERSON, name: null, phone: null });
});

test('the search matches the code or the buyer\'s name, in any case, and nothing else', () => {
  const row = orderRow(SUMMARY, { id: SITE, name: 'Karrada Store' }, { id: PERSON, name: 'Ali Hassan', phone: '9647701234567' });
  for (const text of ['so-2026-0142', '0142', 'ALI', 'hassan', 'ali h']) assert.equal(matchesQuery(row, text), true, text);
  for (const text of ['0143', 'Karrada', '9647701', 'draft']) assert.equal(matchesQuery(row, text), false, text);
  const unnamed = orderRow(SUMMARY, null, { id: PERSON, name: null, phone: null });
  assert.equal(matchesQuery(unnamed, 'ali'), false);
  assert.equal(matchesQuery(unnamed, 'SO-2026'), true);
});

const ORDER_FULL: StorefrontOrder = {
  id: ORDER,
  code: 'SO-2026-0142',
  currency: 'IQD',
  lines: [{
    itemId: '48484848-0001-4848-8848-484848484848', sku: 'TSH-001-S-WHT', name: { en: 'T-shirt', ar: 'قميص' },
    axes: [{ specification: { en: 'Size', ar: 'المقاس' }, option: { en: 'Small', ar: 'صغير' } }],
    unit: { code: 'UOM-000001', name: 'Piece' }, quantity: '2', unitPrice: '25000', lineTotal: '50000',
  }],
  subtotal: '50000',
  deliveryFee: '2500',
  total: '52500',
  paymentMethod: 'cash_on_delivery',
  deliveryAddress: { city: 'بغداد', address: 'الكرادة', landmark: null, phone: '0770 123 4567' },
  status: 'draft',
  customerId: PERSON,
  branchId: 'branch-1',
  sourceReference: SITE,
  notes: 'Call first',
  createdAt: '2026-11-21T08:00:00.000Z',
  updatedAt: '2026-11-21T09:30:00.000Z',
  history: [
    { fromStatus: null, toStatus: 'draft', reason: null, changedBy: { id: '00000000-0000-0000-0000-000000000002', kind: 'storefront', name: 'Storefront (Web Studio)' }, changedAt: '2026-11-21T08:00:00.000Z' },
  ],
};

test('the detail has the lines with their axes, the address, fee, payment method, notes, history, the site, the checkout and the links', () => {
  const buyer = { id: PERSON, name: 'Ali Hassan', phone: '9647701234567' };
  const links = { open_in_sales: `torch://app/s/orders/${ORDER}`, open_in_web_studio: `torch://app/w/orders/${ORDER}` };
  assert.deepEqual(orderDetailView(ORDER_FULL, { site: { id: SITE, name: 'Karrada Store' }, checkoutId: 'checkout-1', buyer, links }), {
    id: ORDER,
    code: 'SO-2026-0142',
    status: 'draft',
    currency: 'IQD',
    site: { id: SITE, name: 'Karrada Store' },
    checkout_id: 'checkout-1',
    buyer,
    lines: [{
      item_id: '48484848-0001-4848-8848-484848484848', sku: 'TSH-001-S-WHT', name: { en: 'T-shirt', ar: 'قميص' },
      axes: [{ specification: { en: 'Size', ar: 'المقاس' }, option: { en: 'Small', ar: 'صغير' } }],
      unit: { code: 'UOM-000001', name: 'Piece' }, quantity: '2', unit_price: '25000', line_total: '50000',
    }],
    subtotal: '50000',
    delivery_fee: '2500',
    total: '52500',
    payment_method: 'cash_on_delivery',
    delivery_address: { city: 'بغداد', address: 'الكرادة', landmark: null, phone: '0770 123 4567' },
    notes: 'Call first',
    history: [{
      from_status: null, to_status: 'draft', reason: null,
      changed_by: { id: '00000000-0000-0000-0000-000000000002', kind: 'storefront', name: 'Storefront (Web Studio)' },
      changed_at: '2026-11-21T08:00:00.000Z',
    }],
    created_at: '2026-11-21T08:00:00.000Z',
    updated_at: '2026-11-21T09:30:00.000Z',
    links,
  });
});

test('an order with no checkout record or no known site is shown with what it has', () => {
  const view = orderDetailView({ ...ORDER_FULL, sourceReference: null, deliveryAddress: null, paymentMethod: null }, {
    site: null,
    checkoutId: null,
    buyer: { id: PERSON, name: null, phone: null },
    links: { open_in_sales: null, open_in_web_studio: null },
  });
  assert.equal(view.site, null);
  assert.equal(view.checkout_id, null);
  assert.equal(view.delivery_address, null);
  assert.equal(view.payment_method, null);
});
