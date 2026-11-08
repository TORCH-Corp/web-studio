import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { StoreImage, StoreProduct, StoreVariant } from '@/lib/platform/catalogue-rules';
import { galleryFor, initialSelection, optionRows, selectOption, variantFor, type Selection } from './picker';

const SIZE = 'spec-size';
const COLOUR = 'spec-colour';

const img = (id: string): StoreImage => ({ document_id: id, url: `/store-media/${id}?item=shirt` });

function variant(id: string, size: string, colour: string, over: Partial<StoreVariant> = {}): StoreVariant {
  const price = over.available === false ? null : { amount: '30000', currency: 'IQD' as const, converted: false };
  return {
    id,
    sku: `SHT-${id}`,
    price,
    available: price !== null,
    unavailable_reason: price === null ? 'inactive' : null,
    image: img('product-main'),
    axes: [
      { specification_id: SIZE, option_id: size, name: 'Size', name_ar: 'المقاس', option: size.toUpperCase(), option_ar: null },
      { specification_id: COLOUR, option_id: colour, name: 'Colour', name_ar: 'اللون', option: colour, option_ar: null },
    ],
    ...over,
  };
}

function product(variants: StoreVariant[], over: Partial<StoreProduct> = {}): StoreProduct {
  const sizes = [...new Set(variants.flatMap((v) => v.axes.filter((a) => a.specification_id === SIZE).map((a) => a.option_id)))];
  const colours = [...new Set(variants.flatMap((v) => v.axes.filter((a) => a.specification_id === COLOUR).map((a) => a.option_id)))];
  return {
    id: 'shirt',
    sku: 'SHT',
    name: 'Linen shirt',
    name_ar: null,
    description: null,
    description_ar: null,
    price: { amount: '30000', currency: 'IQD', converted: false, from: true },
    unit: null,
    images: [img('product-main')],
    category: null,
    variants,
    axes_summary: [
      { id: SIZE, code: 'SZ', name: 'Size', name_ar: 'المقاس', options: sizes.map((id) => ({ id, code: id, label: id.toUpperCase(), label_ar: null })) },
      { id: COLOUR, code: 'CLR', name: 'Colour', name_ar: 'اللون', options: colours.map((id) => ({ id, code: id, label: id, label_ar: null })) },
    ],
    ...over,
  };
}

// The handoff's shirt: Grey and XL cannot be bought.
const SHIRT = product([
  variant('s-black', 's', 'black', { price: { amount: '28000', currency: 'IQD', converted: false } }),
  variant('m-black', 'm', 'black'),
  variant('m-white', 'm', 'white'),
  variant('xl-white', 'xl', 'white', { available: false }),
  variant('m-grey', 'm', 'grey', { available: false }),
]);

const selected = (selection: Selection) => variantFor(SHIRT, selection)?.id;

test('the page opens on the cheapest variant that can be bought, so its price is the card\'s "from" price', () => {
  assert.deepEqual(initialSelection(SHIRT), { [SIZE]: 's', [COLOUR]: 'black' });
});

test('a product without variants has nothing to pick and nothing selected', () => {
  const plain = product([], { axes_summary: [] });
  assert.deepEqual(initialSelection(plain), {});
  assert.equal(variantFor(plain, {}), null);
  assert.deepEqual(optionRows(plain, {}), []);
});

test('the variant of a selection is the one that has exactly those options', () => {
  assert.equal(selected({ [SIZE]: 'm', [COLOUR]: 'white' }), 'm-white');
  assert.equal(selected({ [SIZE]: 's', [COLOUR]: 'white' }), undefined, 'no such variant');
  assert.equal(selected({ [SIZE]: 'm' }), undefined, 'one axis only is not a variant');
});

test('one row of chips per axis; an option no variant can be bought in is disabled and the chosen one is marked', () => {
  const rows = optionRows(SHIRT, { [SIZE]: 'm', [COLOUR]: 'white' });
  assert.deepEqual(rows.map((row) => row.axis.id), [SIZE, COLOUR]);
  const state = (specId: string) => rows.find((row) => row.axis.id === specId)!.options.map((o) => [o.id, o.selected, o.unavailable]);
  assert.deepEqual(state(SIZE), [['s', false, false], ['m', true, false], ['xl', false, true]]);
  assert.deepEqual(state(COLOUR), [['black', false, false], ['white', true, false], ['grey', false, true]]);
});

test('picking an option that goes with the current choice changes only that axis', () => {
  const next = selectOption(SHIRT, { [SIZE]: 'm', [COLOUR]: 'black' }, COLOUR, 'white');
  assert.deepEqual(next, { [SIZE]: 'm', [COLOUR]: 'white' });
});

test('picking an option that no variant has with the current choice moves the other axes to the nearest variant that can be bought', () => {
  // Small comes only in black; white is chosen with medium, so small brings black back.
  const next = selectOption(SHIRT, { [SIZE]: 'm', [COLOUR]: 'white' }, SIZE, 's');
  assert.deepEqual(next, { [SIZE]: 's', [COLOUR]: 'black' });
  assert.equal(selected(next), 's-black');
});

test('a disabled option cannot be picked: nothing changes', () => {
  const now = { [SIZE]: 'm', [COLOUR]: 'white' };
  assert.deepEqual(selectOption(SHIRT, now, SIZE, 'xl'), now);
  assert.deepEqual(selectOption(SHIRT, now, COLOUR, 'grey'), now);
});

test('an option the axis does not list is ignored', () => {
  const now = { [SIZE]: 'm', [COLOUR]: 'white' };
  assert.deepEqual(selectOption(SHIRT, now, SIZE, 'nope'), now);
  assert.deepEqual(selectOption(SHIRT, now, 'nope', 'm'), now);
});

test('a product with one axis picks like a list', () => {
  const sizes = product(
    [
      { ...variant('s', 's', 'x'), axes: [{ specification_id: SIZE, option_id: 's', name: 'Size', name_ar: null, option: 'S', option_ar: null }] },
      { ...variant('l', 'l', 'x', { available: false }), axes: [{ specification_id: SIZE, option_id: 'l', name: 'Size', name_ar: null, option: 'L', option_ar: null }] },
    ],
  );
  sizes.axes_summary = sizes.axes_summary.filter((axis) => axis.id === SIZE);
  assert.deepEqual(initialSelection(sizes), { [SIZE]: 's' });
  assert.equal(variantFor(sizes, { [SIZE]: 's' })?.id, 's');
});

test('the gallery shows the variant\'s own image, else the product\'s; the thumbnails are every distinct image once', () => {
  const withOwn = product(
    [
      variant('m-black', 'm', 'black', { image: img('black') }),
      variant('m-white', 'm', 'white', { image: img('white') }),
      variant('m-navy', 'm', 'navy'),
    ],
    { images: [img('product-main'), img('detail')] },
  );
  const black = galleryFor(withOwn, withOwn.variants[0], null);
  assert.equal(black.main?.document_id, 'black');
  assert.deepEqual(black.thumbs.map((t) => [t.image.document_id, t.on]), [['product-main', false], ['detail', false], ['black', true], ['white', false]]);
  const navy = galleryFor(withOwn, withOwn.variants[2], null);
  assert.equal(navy.main?.document_id, 'product-main', 'no image of its own: the product\'s');
  assert.deepEqual(navy.thumbs.map((t) => t.on), [true, false, false, false]);
});

test('a thumbnail the buyer picked stays the main image until the variant changes', () => {
  const withOwn = product([variant('m-black', 'm', 'black', { image: img('black') })], { images: [img('product-main'), img('detail')] });
  const picked = galleryFor(withOwn, withOwn.variants[0], 'detail');
  assert.equal(picked.main?.document_id, 'detail');
  assert.deepEqual(picked.thumbs.map((t) => t.on), [false, true, false]);
  assert.equal(galleryFor(withOwn, withOwn.variants[0], 'not-an-image').main?.document_id, 'black', 'a stale pick falls back to the variant\'s image');
});

test('with one image there are no thumbnails, with none there is no main image', () => {
  assert.deepEqual(galleryFor(SHIRT, SHIRT.variants[0], null).thumbs, []);
  const bare = product([], { images: [], axes_summary: [] });
  const gallery = galleryFor(bare, null, null);
  assert.equal(gallery.main, null);
  assert.deepEqual(gallery.thumbs, []);
});
