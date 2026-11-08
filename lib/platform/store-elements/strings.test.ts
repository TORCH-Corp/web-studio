import assert from 'node:assert/strict';
import { test } from 'node:test';

import { badgeText, STORE_STRINGS, storeDirOf, storeLangOf } from './strings';

test('Arabic locales are Arabic and right to left, every other locale is English and left to right', () => {
  for (const code of ['ar', 'AR', 'ar-IQ', 'ar_SA']) assert.deepEqual([storeLangOf(code), storeDirOf(storeLangOf(code))], ['ar', 'rtl']);
  for (const code of ['en', 'en-GB', 'fr', 'ku', 'arm', '', null, undefined]) assert.deepEqual([storeLangOf(code), storeDirOf(storeLangOf(code))], ['en', 'ltr']);
});

test('the cart badge is hidden at 0, the count to 99, "99+" above', () => {
  assert.equal(badgeText(0), null);
  assert.equal(badgeText(-3), null);
  assert.equal(badgeText(NaN), null);
  assert.equal(badgeText(1), '1');
  assert.equal(badgeText(99), '99');
  assert.equal(badgeText(100), '99+');
  assert.equal(badgeText(120), '99+');
  assert.equal(badgeText(4.9), '4');
});

test('the words come from the handoff in both languages, and every key is in both', () => {
  assert.deepEqual(Object.keys(STORE_STRINGS.ar).sort(), Object.keys(STORE_STRINGS.en).sort());
  assert.equal(STORE_STRINGS.en.addToCart, 'Add to cart');
  assert.equal(STORE_STRINGS.en.chooseOptions, 'Choose options');
  assert.equal(STORE_STRINGS.ar.addToCart, 'أضف إلى السلة');
  assert.equal(STORE_STRINGS.ar.chooseOptions, 'اختر الخيارات');
  assert.equal(STORE_STRINGS.en.emptyCategoryTitle('Women'), 'No products in “Women” yet');
  assert.equal(STORE_STRINGS.ar.emptyCategoryTitle('نسائي'), 'لا توجد منتجات في قسم «نسائي» حاليًا');
  assert.equal(STORE_STRINGS.en.noResultsTitle('wool shirt'), 'No results for “wool shirt”');
  assert.equal(STORE_STRINGS.ar.noResultsTitle('قميص صوف'), 'لا نتائج لـ «قميص صوف»');
});

test('the cart label says the count in each language', () => {
  assert.equal(STORE_STRINGS.en.cartCount(4), 'Cart: 4 items');
  assert.equal(STORE_STRINGS.en.cartCount(1), 'Cart: 1 item');
  assert.equal(STORE_STRINGS.ar.cartCount(4), 'السلة: 4 قطع');
  assert.equal(STORE_STRINGS.ar.cartCount(120), 'السلة: 120 قطع');
});

test('the product page speaks in the handoff\'s words in both languages', () => {
  const en = STORE_STRINGS.en;
  const ar = STORE_STRINGS.ar;
  assert.equal(en.sku, 'SKU');
  assert.equal(ar.sku, 'رمز المنتج');
  assert.equal(en.unavailableOption, 'unavailable');
  assert.equal(ar.unavailableOption, 'غير متوفر');
  assert.equal(en.viewCart, 'View cart');
  assert.equal(ar.viewCart, 'عرض السلة');
  assert.equal(en.addedToCart('Cotton T-shirt', ['Black', 'M']), 'Cotton T-shirt (Black, M) added to your cart.');
  assert.equal(en.addedToCart('Desk lamp', []), 'Desk lamp added to your cart.');
  assert.equal(ar.addedToCart('قميص قطني', ['أسود', 'M']), 'تمت إضافة قميص قطني (أسود، M) إلى السلة.');
  assert.equal(ar.addedToCart('مصباح', []), 'تمت إضافة مصباح إلى السلة.');
  assert.equal(en.axisLabel('Colour'), 'Colour:');
  assert.equal(ar.axisLabel('اللون'), 'اللون:');
});

test('a product that is gone says it is no longer available, as decision 16g words it, and offers the way back', () => {
  assert.equal(STORE_STRINGS.en.notOnSaleTitle, 'This product is no longer available');
  assert.equal(STORE_STRINGS.en.browseProducts, 'Browse products');
  assert.equal(STORE_STRINGS.ar.notOnSaleTitle, 'هذا المنتج لم يعد متاحًا');
});
