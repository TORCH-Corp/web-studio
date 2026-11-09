import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DESCRIPTION_MAX, productCanonicalPath, productDescription, productSeo, productTitle } from './product-seo';

const SHIRT = { id: '48484848-0006-4848-8848-484848484848', name: 'Linen shirt', name_ar: 'قميص كتان', description: 'Washed linen.', description_ar: 'كتان مغسول.' };

test('the title is the product\'s name, a middle dot and the site\'s name; the name alone when the site has none', () => {
  assert.equal(productTitle('Linen shirt', 'Karrada Store'), 'Linen shirt · Karrada Store');
  assert.equal(productTitle('قميص كتان', 'متجر الكرادة'), 'قميص كتان · متجر الكرادة');
  assert.equal(productTitle('Linen shirt', null), 'Linen shirt');
  assert.equal(productTitle('Linen shirt', ''), 'Linen shirt');
  assert.equal(productTitle('Linen shirt', '   '), 'Linen shirt');
});

test('the description is the product\'s, its first 160 characters, on one line', () => {
  assert.equal(productDescription('Washed linen.'), 'Washed linen.');
  const long = `${'a'.repeat(100)} ${'b'.repeat(100)}`;
  assert.equal(productDescription(long), long.slice(0, DESCRIPTION_MAX));
  assert.equal(DESCRIPTION_MAX, 160);
  assert.equal(Array.from(productDescription('x'.repeat(500))!).length, 160);
  // Line breaks and runs of spaces are a space; the ends are trimmed, also after the cut.
  assert.equal(productDescription('  Washed\n\nlinen,\t  soft. '), 'Washed linen, soft.');
  assert.equal(productDescription(`${'a'.repeat(159)} bbb`), 'a'.repeat(159));
  // Characters, not UTF-16 units: an emoji is not cut in half.
  assert.equal(Array.from(productDescription('😀'.repeat(200))!).length, 160);
  assert.doesNotMatch(productDescription('😀'.repeat(200))!, /�|[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
});

test('a product with no description has none: the head falls back to what the page and the site say', () => {
  assert.equal(productDescription(null), null);
  assert.equal(productDescription(''), null);
  assert.equal(productDescription(' \n '), null);
});

test('the head values are in the page\'s language, Arabic when the page is Arabic and the product has an Arabic text, English otherwise', () => {
  assert.deepEqual(productSeo({ product: SHIRT, lang: 'en', siteName: 'Karrada Store' }), { title: 'Linen shirt · Karrada Store', description: 'Washed linen.' });
  assert.deepEqual(productSeo({ product: SHIRT, lang: 'ar', siteName: 'متجر الكرادة' }), { title: 'قميص كتان · متجر الكرادة', description: 'كتان مغسول.' });
  // No Arabic name or description: the English ones, as every store text does.
  const englishOnly = { ...SHIRT, name_ar: null, description_ar: null };
  assert.deepEqual(productSeo({ product: englishOnly, lang: 'ar', siteName: null }), { title: 'Linen shirt', description: 'Washed linen.' });
  assert.deepEqual(productSeo({ product: { ...SHIRT, description: null, description_ar: null }, lang: 'en', siteName: 'S' }), { title: 'Linen shirt · S', description: null });
});

test('the canonical path is the page\'s path and the item\'s id, in lower case, whatever the request spelled', () => {
  const id = SHIRT.id;
  assert.equal(productCanonicalPath('products/' + id.toUpperCase(), id), `/products/${id}`);
  assert.equal(productCanonicalPath(`ar/products/${id}`, id), `/ar/products/${id}`);
  assert.equal(productCanonicalPath(`shop/products/${id}`, id), `/shop/products/${id}`);
  assert.equal(productCanonicalPath(`/products/${id}/`, id), `/products/${id}`);
  assert.equal(productCanonicalPath(`ar/${encodeURIComponent('منتجات')}/${id}`, id), `/ar/${encodeURIComponent('منتجات')}/${id}`);
});
