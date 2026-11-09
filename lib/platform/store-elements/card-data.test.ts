import assert from 'node:assert/strict';
import { test } from 'node:test';

import { cardOf, confirmationLineName, nameFor } from './card-data';
import { optionRows, variantFor } from './picker';
import { SAMPLE_SELECTION, sampleCard, sampleCards, sampleProduct } from './sample-data';

const PLAIN = {
  id: 'lamp',
  name: 'Lamp',
  name_ar: 'مصباح',
  price: { amount: '9000', currency: 'IQD' as const, converted: false, from: false },
  unit: { name: 'Piece', symbol: 'pcs' },
  images: [{ document_id: 'd1', url: '/store-media/d1?item=lamp' }],
  variants: [],
};

test('a plain product is a card with its price, its image and an Add to cart', () => {
  assert.deepEqual(cardOf(PLAIN), {
    id: 'lamp',
    name: 'Lamp',
    name_ar: 'مصباح',
    price: { amount: '9000', currency: 'IQD' },
    from: false,
    imageUrl: '/store-media/d1?item=lamp',
    hasVariants: false,
    unit: { name: 'Piece', symbol: 'pcs' },
  });
  assert.equal(cardOf({ ...PLAIN, unit: null }).unit, null);
});

test('a product with variants is "from" its lowest price and has variants; one with no image has no image url', () => {
  const card = cardOf({ ...PLAIN, price: { ...PLAIN.price, from: true }, images: [], variants: [{} as never] });
  assert.equal(card.from, true);
  assert.equal(card.hasVariants, true);
  assert.equal(card.imageUrl, null);
});

test('the name is Arabic on an Arabic page when the product has an Arabic name, English otherwise', () => {
  assert.equal(nameFor({ name: 'Lamp', name_ar: 'مصباح' }, 'ar'), 'مصباح');
  assert.equal(nameFor({ name: 'Lamp', name_ar: null }, 'ar'), 'Lamp');
  assert.equal(nameFor({ name: 'Lamp', name_ar: 'مصباح' }, 'en'), 'Lamp');
});

test('the canvas draws the handoff\'s eight sample products at most, whatever the page size', () => {
  assert.equal(sampleCards(12).length, 8);
  assert.equal(sampleCards(48).length, 8);
  assert.equal(sampleCards(3).length, 3);
  assert.equal(sampleCards(0).length, 1);
  const cards = sampleCards(8);
  assert.deepEqual(cards.filter((card) => card.from).map((card) => card.name), ['Cotton T-shirt', 'Wool hoodie', 'Wool scarf', 'Long-sleeve linen shirt']);
  assert.ok(cards.every((card) => card.hasVariants === card.from && card.imageUrl === null));
  assert.equal(new Set(cards.map((card) => card.id)).size, 8);
  assert.equal(sampleCard().from, false);
});

test('the canvas draws the handoff\'s T-shirt with Grey and XL that cannot be bought, Black and M chosen, and no picture to fetch', () => {
  const product = sampleProduct();
  const rows = optionRows(product, SAMPLE_SELECTION);
  const unavailable = rows.flatMap((row) => row.options.filter((o) => o.unavailable).map((o) => o.label));
  assert.deepEqual(unavailable, ['Grey', 'XL'], 'Colour is the first row, as the handoff draws it');
  assert.deepEqual(rows.flatMap((row) => row.options.filter((o) => o.selected).map((o) => o.label)), ['Black', 'M']);
  const variant = variantFor(product, SAMPLE_SELECTION);
  assert.equal(variant?.price?.amount, '25000');
  assert.equal(variant?.sku, 'TS-001-BLK-M');
  assert.ok(product.images.every((image) => image.url === ''), 'the canvas never asks the store for a picture');
});

test('a confirmation line shows its product\'s name above the options, in the page\'s language, and Sales\'s own name when it has none (OPEN_QUESTIONS 47)', () => {
  const variant = { name: 'Cotton T-shirt - Black / M', name_ar: null, product_name: 'Cotton T-shirt', product_name_ar: 'قميص قطني' };
  assert.equal(confirmationLineName(variant, 'en'), 'Cotton T-shirt');
  assert.equal(confirmationLineName(variant, 'ar'), 'قميص قطني');
  // A product with no Arabic name reads English on an Arabic page, as every name does.
  assert.equal(confirmationLineName({ ...variant, product_name_ar: null }, 'ar'), 'Cotton T-shirt');
  // A plain item, or a variant whose product the catalogue no longer has: the line's own name.
  const plain = { name: 'Desk lamp', name_ar: 'مصباح مكتب', product_name: null, product_name_ar: null };
  assert.equal(confirmationLineName(plain, 'en'), 'Desk lamp');
  assert.equal(confirmationLineName(plain, 'ar'), 'مصباح مكتب');
  assert.equal(confirmationLineName({ ...variant, product_name: null, product_name_ar: null }, 'en'), 'Cotton T-shirt - Black / M');
});
