import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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
  assert.equal(STORE_STRINGS.ar.cartCount(4), 'السلة: 4 قطعة');
  assert.equal(STORE_STRINGS.ar.cartCount(120), 'السلة: 120 قطعة');
});

test('Arabic counts use the invariant singular after the count, for every count (OPEN_QUESTIONS 51, context/rules/rtl-and-i18n.md)', () => {
  const ar = STORE_STRINGS.ar;
  // The plural "قطع" is right for 3 to 10 only; "قطعة" after the number reads right for all of them.
  for (const count of [1, 2, 3, 4, 10, 11, 25, 99, 120]) {
    assert.equal(ar.cartCount(count), `السلة: ${count} قطعة`);
    assert.equal(ar.itemCount(count), `${count} قطعة`);
    assert.equal(ar.summaryCount(count), `· ${count} قطعة`);
    for (const text of [ar.cartCount(count), ar.itemCount(count), ar.summaryCount(count)]) assert.doesNotMatch(text, /قطع(?!ة)/);
  }
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

test('decision 16g: no word of the store pages speaks of stock, and the items that cannot be sold are "no longer available"', () => {
  // Nothing in the platform holds stock, so no page may say an item is out of it (the handoff's cart said so once).
  assert.doesNotMatch(readFileSync(join(__dirname, 'strings.ts'), 'utf8'), /stock|مخزون|نفد/i);
  assert.equal(STORE_STRINGS.en.itemsUnavailableText(['Wool hoodie — Colour: Grey, Size: L']), '“Wool hoodie — Colour: Grey, Size: L” is no longer available. Remove it to place your order.');
  assert.equal(STORE_STRINGS.en.itemsUnavailableText(['A', 'B']), '“A”, “B” are no longer available. Remove them to place your order.');
  assert.equal(STORE_STRINGS.ar.itemsUnavailableText(['هودي صوف']), '«هودي صوف» لم يعد متاحًا. أزله لتتمكّن من تأكيد الطلب.');
  assert.equal(STORE_STRINGS.en.itemsUnavailableTitle(1), 'An item is no longer available');
  assert.equal(STORE_STRINGS.en.itemsUnavailableTitle(2), 'Some items are no longer available');
});

test('the cart, checkout and confirmation speak in the handoff\'s words in both languages', () => {
  const en = STORE_STRINGS.en;
  const ar = STORE_STRINGS.ar;
  assert.deepEqual([en.cartTitle, ar.cartTitle], ['Shopping cart', 'سلة التسوق']);
  assert.deepEqual([en.itemCount(4), en.itemCount(1), ar.itemCount(4)], ['4 items', '1 item', '4 قطعة']);
  assert.deepEqual([en.checkout, ar.checkout], ['Checkout', 'إتمام الطلب']);
  assert.deepEqual([en.placeOrder('115,000 IQD'), ar.placeOrder('115,000 د.ع')], ['Place order · 115,000 IQD', 'تأكيد الطلب · 115,000 د.ع']);
  assert.deepEqual([en.placing, ar.placing], ['Placing your order…', 'جارٍ إرسال الطلب…']);
  assert.deepEqual([en.cashOnDelivery, ar.cashOnDelivery], ['Cash on delivery', 'الدفع عند الاستلام']);
  assert.deepEqual([en.orderCode, ar.orderCode], ['Order code', 'رمز الطلب']);
  assert.equal(en.cashReady('115,000 IQD'), 'Have 115,000 IQD in cash ready to pay the courier on delivery.');
  assert.equal(ar.cashReady('115,000 د.ع'), 'جهّز مبلغ 115,000 د.ع نقدًا لتدفعه للمندوب عند الاستلام.');
  assert.equal(en.pricePerUnit('25,000 IQD', null), '25,000 IQD each');
  assert.equal(en.pricePerUnit('25,000 IQD', 'pcs'), '25,000 IQD / pcs');
  assert.equal(ar.pricePerUnit('25,000 د.ع', null), '25,000 د.ع / للقطعة');
  assert.equal(en.fixFields(3), 'Your order wasn’t sent. Fix 3 fields:');
  assert.equal(en.fixFields(1), 'Your order wasn’t sent. Fix 1 field:');
  assert.equal(ar.fixFields(3), 'لم يُرسَل الطلب. صحّح 3 حقول:');
  assert.equal(ar.fixFields(2), 'لم يُرسَل الطلب. صحّح الحقلين التاليين:');
  assert.equal(ar.fixFields(1), 'لم يُرسَل الطلب. صحّح الحقل التالي:');
});
