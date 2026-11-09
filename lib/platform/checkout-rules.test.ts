import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildCatalogue, type CatalogueInput } from './catalogue-rules';
import { confirmationOf, itemName, lineRefusal, salesRefusalAnswer, unavailableLines } from './checkout-rules';
import type { CatalogueItem, CatalogueVariant, VariantWorkspace } from './product-services';
import type { SalesOrder } from './sales';

const item = (id: string, extra: Partial<CatalogueItem> = {}): CatalogueItem => ({
  id, sku: `SKU-${id}`, name: id, name_ar: null, description: null, description_ar: null, status: 'ACTIVE', base_price: '25000',
  currency: 'IQD', category_id: 'home', parent_item_id: null, has_variants: false, base_uom_id: null, primary_image_document_id: null, ...extra,
});

const variant = (id: string, size: [string, string | null], colour: [string, string | null], extra: Partial<CatalogueVariant> = {}): CatalogueVariant => ({
  ...item(id, { parent_item_id: 'shirt', ...extra }),
  axes: [
    { specification_id: 'size', specification_name: 'Size', specification_name_ar: 'المقاس', option_id: `size-${size[0]}`, option_label: size[0], option_label_ar: size[1] },
    { specification_id: 'colour', specification_name: 'Colour', specification_name_ar: null, option_id: `colour-${colour[0]}`, option_label: colour[0], option_label_ar: colour[1] },
  ],
});

const WORKSPACE: VariantWorkspace = {
  axes_summary: [],
  variants: [
    variant('shirt-m', ['Medium', 'وسط'], ['White', 'أبيض'], { status: 'DISCONTINUED' }),
    variant('shirt-l', ['Large', 'كبير'], ['White', 'أبيض'], { base_price: null }),
    variant('shirt-s-blue', ['Small', 'صغير'], ['Blue', null], { base_price: '20', currency: 'USD' }),
    variant('shirt-s-white', ['Small', 'صغير'], ['White', 'أبيض'], { base_price: '35000' }),
  ],
};

const input = (overrides: Partial<CatalogueInput> = {}): CatalogueInput => ({
  items: [
    item('lamp', { name: 'Desk lamp', name_ar: 'مصباح مكتب' }),
    item('sample', { name: 'Free sample', base_price: '0' }),
    item('shirt', { name: 'Linen shirt', name_ar: 'قميص كتان', has_variants: true, base_price: '0' }),
  ],
  workspaces: new Map([['shirt', WORKSPACE]]),
  tree: [{ id: 'home', name: 'Home', name_ar: null, parent_id: null, archived: false, items_count: 0, children: [] }],
  store: { currency: 'IQD', category_ids: [] },
  rate: '1520',
  units: new Map(),
  ...overrides,
});

const CATALOGUE = buildCatalogue(input());
const NO_RATE = buildCatalogue(input({ rate: null }));
const lines = (...ids: string[]) => ids.map((item_id) => ({ item_id, quantity: '1' }));

test('a plain item and an available variant can be bought; a product with variants, an unavailable variant and anything not on sale cannot', () => {
  assert.equal(lineRefusal(CATALOGUE, 'lamp'), null);
  assert.equal(lineRefusal(CATALOGUE, 'shirt-s-white'), null);
  assert.equal(lineRefusal(CATALOGUE, 'shirt-s-blue'), null);
  assert.equal(lineRefusal(CATALOGUE, 'shirt'), 'parent');
  assert.equal(lineRefusal(CATALOGUE, 'shirt-m'), 'inactive');
  assert.equal(lineRefusal(CATALOGUE, 'shirt-l'), 'no_price');
  assert.equal(lineRefusal(NO_RATE, 'shirt-s-blue'), 'no_rate');
  assert.equal(lineRefusal(CATALOGUE, 'sample'), 'not_on_sale'); // priced 0: the catalogue does not list it
  assert.equal(lineRefusal(CATALOGUE, 'unknown'), 'not_on_sale');
});

test('the refused lines are named once each, in the cart\'s order, in the page\'s language', () => {
  assert.deepEqual(unavailableLines(CATALOGUE, lines('lamp', 'shirt-s-white'), 'en'), []);
  assert.deepEqual(unavailableLines(CATALOGUE, lines('shirt-m', 'lamp', 'shirt', 'unknown', 'shirt-m'), 'en'), [
    { item_id: 'shirt-m', name: 'Linen shirt — Size: Medium, Colour: White', reason: 'inactive' },
    { item_id: 'shirt', name: 'Linen shirt', reason: 'parent' },
    { item_id: 'unknown', name: null, reason: 'not_on_sale' },
  ]);
  assert.deepEqual(unavailableLines(NO_RATE, lines('shirt-s-blue'), 'ar'), [
    // Colour has no Arabic name and Blue no Arabic label: the English ones stand in.
    { item_id: 'shirt-s-blue', name: 'قميص كتان — المقاس: صغير، Colour: Blue', reason: 'no_rate' },
  ]);
});

test('a name falls back to English where Product & Services has no Arabic', () => {
  assert.equal(itemName(CATALOGUE, 'lamp', 'ar'), 'مصباح مكتب');
  assert.equal(itemName(buildCatalogue(input({ items: [item('lamp', { name: 'Desk lamp' })] })), 'lamp', 'ar'), 'Desk lamp');
  assert.equal(itemName(CATALOGUE, 'shirt-s-white', 'ar'), 'قميص كتان — المقاس: صغير، Colour: أبيض');
  assert.equal(itemName(CATALOGUE, 'unknown', 'en'), null);
});

test('Sales\'s item refusals name the cart\'s lines it gives, with the reason of its code', () => {
  const cart = lines('lamp', 'shirt-s-white');
  assert.deepEqual(salesRefusalAnswer({ code: 'item_inactive', items: ['SHIRT-S-WHITE'.toLowerCase()] }, cart, CATALOGUE, 'en'), {
    kind: 'item_unavailable',
    items: [{ item_id: 'shirt-s-white', name: 'Linen shirt — Size: Small, Colour: White', reason: 'inactive' }],
  });
  for (const [code, reason] of [
    ['item_not_found', 'not_on_sale'],
    ['item_is_parent', 'parent'],
    ['item_no_price', 'no_price'],
    ['item_currency_mismatch', 'no_price'],
    ['no_rate_for_date', 'no_rate'],
  ] as const) {
    assert.deepEqual(salesRefusalAnswer({ code, items: ['lamp', 'lamp'] }, cart, CATALOGUE, 'ar'), { kind: 'item_unavailable', items: [{ item_id: 'lamp', name: 'مصباح مكتب', reason }] }, code);
  }
});

test('a Sales refusal the buyer cannot fix is the store\'s: the customer, the branch, the order\'s own rate, ids not in the cart, an unknown code', () => {
  const cart = lines('lamp');
  for (const refusal of [
    { code: 'customer_not_found', items: [] },
    { code: 'customer_archived', items: [] },
    { code: 'branch_not_found', items: [] },
    { code: 'no_rate_for_date', items: [] },
    { code: 'item_inactive', items: [] },
    { code: 'item_inactive', items: ['not-in-cart'] },
    { code: 'something_new', items: ['lamp'] },
  ]) {
    const answer = salesRefusalAnswer(refusal, cart, CATALOGUE, 'en');
    assert.equal(answer.kind, 'service_unavailable', JSON.stringify(refusal));
    assert.match((answer as { reason: string }).reason, new RegExp(refusal.code));
  }
});

test('the confirmation shows the order\'s lines with their axes, the fee, the total, the payment method and the typed phone', () => {
  const order: SalesOrder = {
    id: 'o1',
    code: 'SO-2026-0142',
    currency: 'IQD',
    lines: [
      {
        itemId: 'shirt-s-white', sku: 'SHT-001-S-WHT', name: { en: 'Linen shirt - Small / White', ar: null },
        axes: [{ specification: { en: 'Size', ar: 'المقاس' }, option: { en: 'Small', ar: 'صغير' } }],
        unit: { code: 'UOM-000001', name: 'Piece' }, quantity: '2', unitPrice: '35000', lineTotal: '70000',
      },
    ],
    subtotal: '70000',
    deliveryFee: '2500',
    total: '72500',
    paymentMethod: 'cash_on_delivery',
    deliveryAddress: { city: 'بغداد', address: 'الكرادة', landmark: null, phone: '0770 123 4567' },
  };
  assert.deepEqual(confirmationOf('c1', order), {
    checkout_id: 'c1',
    code: 'SO-2026-0142',
    currency: 'IQD',
    lines: [
      {
        item_id: 'shirt-s-white', sku: 'SHT-001-S-WHT', name: 'Linen shirt - Small / White', name_ar: null,
        product_name: null, product_name_ar: null,
        axes: [{ name: 'Size', name_ar: 'المقاس', option: 'Small', option_ar: 'صغير' }],
        unit: { code: 'UOM-000001', name: 'Piece' }, quantity: '2', unit_price: '35000', line_total: '70000',
      },
    ],
    subtotal: '70000',
    delivery_fee: '2500',
    total: '72500',
    payment_method: 'cash_on_delivery',
    phone: '0770 123 4567',
  });
  assert.equal(confirmationOf('c1', { ...order, deliveryAddress: null }).phone, null);
});

test('a variant line also carries its product\'s name apart from the options, and Sales\'s own line name stays as Sales wrote it (OPEN_QUESTIONS 47)', () => {
  const line = (itemId: string, name: string, axes: SalesOrder['lines'][number]['axes']): SalesOrder['lines'][number] => ({
    itemId, sku: itemId.toUpperCase(), name: { en: name, ar: null }, axes,
    unit: { code: 'UOM-000001', name: 'Piece' }, quantity: '1', unitPrice: '1000', lineTotal: '1000',
  });
  const size = [{ specification: { en: 'Size', ar: 'المقاس' }, option: { en: 'Small', ar: 'صغير' } }];
  const order: SalesOrder = {
    id: 'o1', code: 'SO-2026-0143', currency: 'IQD',
    lines: [line('lamp', 'Desk lamp', []), line('shirt-s', 'Linen shirt - Small', size), line('gone-s', 'Old shirt - Small', size)],
    subtotal: '3000', deliveryFee: '0', total: '3000', paymentMethod: 'cash_on_delivery', deliveryAddress: null,
  };
  const products = new Map([['shirt-s', { name: 'Linen shirt', name_ar: 'قميص كتان' }]]);
  const lines = confirmationOf('c1', order, (itemId) => products.get(itemId) ?? null).lines;
  assert.deepEqual(lines.map((l) => [l.item_id, l.name, l.name_ar, l.product_name, l.product_name_ar]), [
    ['lamp', 'Desk lamp', null, null, null], // a plain item is named by its own line, as before
    ['shirt-s', 'Linen shirt - Small', null, 'Linen shirt', 'قميص كتان'], // Sales's name is Sales's; the product's name is apart
    ['gone-s', 'Old shirt - Small', null, null, null], // a product the catalogue no longer has: Sales's name is all there is
  ]);
  assert.deepEqual(lines[1].axes, [{ name: 'Size', name_ar: 'المقاس', option: 'Small', option_ar: 'صغير' }]);
  // Without a lookup (the product names were not read) no line has one.
  assert.deepEqual(confirmationOf('c1', order).lines.map((l) => l.product_name), [null, null, null]);
  // The lookup is asked only about variant lines: a plain line never needs the catalogue.
  const asked: string[] = [];
  confirmationOf('c1', order, (itemId) => { asked.push(itemId); return null; });
  assert.deepEqual(asked, ['shirt-s', 'gone-s']);
});
