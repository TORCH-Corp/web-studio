import assert from 'node:assert/strict';
import { test } from 'node:test';

import { cardOf, nameFor } from './card-data';
import { sampleCard, sampleCards } from './sample-data';

const PLAIN = {
  id: 'lamp',
  name: 'Lamp',
  name_ar: 'مصباح',
  price: { amount: '9000', currency: 'IQD' as const, converted: false, from: false },
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
  });
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
