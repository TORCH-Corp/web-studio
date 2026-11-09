import assert from 'node:assert/strict';
import { test } from 'node:test';

import { canonicalIraqiMobile, checkoutLocale, LIMITS, MESSAGES, parseCheckout, type CheckoutInput } from './checkout-input';
import { IRAQ_GOVERNORATES, governorateByCode } from './iraq-governorates';

const CHECKOUT = '3f0b2c7e-2d7a-4c3e-9a1e-7b1d2e3f4a5b';
const LAMP = '48484848-0001-4848-8848-484848484848';
const SHIRT_S = '48484848-0007-4848-8848-484848484848';

const body = (overrides: { buyer?: Record<string, unknown>; [key: string]: unknown } = {}) => {
  const { buyer, ...rest } = overrides;
  return {
    checkout_id: CHECKOUT,
    buyer: { name: 'Ali Hassan', phone: '0770 123 4567', city: 'baghdad', address: 'Karrada, street 62, house 14', ...buyer },
    lines: [{ item_id: LAMP, quantity: '2' }],
    locale: 'en',
    ...rest,
  };
};

function accepted(value: unknown, siteDefault = 'en'): CheckoutInput {
  const parsed = parseCheckout(value, siteDefault);
  assert.equal(parsed.ok, true, JSON.stringify(parsed));
  return (parsed as { value: CheckoutInput }).value;
}

function fieldErrors(value: unknown, siteDefault = 'en'): Record<string, string> {
  const parsed = parseCheckout(value, siteDefault);
  assert.equal(parsed.ok, false);
  assert.equal((parsed as { kind: string }).kind, 'invalid_checkout', JSON.stringify(parsed));
  return (parsed as { fields: Record<string, string> }).fields;
}

function bodyError(value: unknown): string {
  const parsed = parseCheckout(value, 'en');
  assert.equal(parsed.ok, false);
  assert.equal((parsed as { kind: string }).kind, 'invalid_body', JSON.stringify(parsed));
  return (parsed as { message: string }).message;
}

test('an Iraqi mobile number is taken with 0, 964, +964 or 00964, in ASCII or Arabic digits, and becomes 964 and its ten digits', () => {
  for (const typed of [
    '0770 123 4567',
    '07701234567',
    '+964 770 123 4567',
    '+9647701234567',
    '00964 770 123 4567',
    '9647701234567',
    '(0770) 123-4567',
    '0770.123.4567',
    '٠٧٧٠١٢٣٤٥٦٧',
    '۰۷۷۰ ۱۲۳ ۴۵۶۷',
    '‎+964 770 123 4567‎',
    '  0770 123 4567  ',
  ]) {
    assert.equal(canonicalIraqiMobile(typed), '9647701234567', typed);
  }
  assert.equal(canonicalIraqiMobile('0750 987 6543'), '9647509876543');
});

test('anything but an Iraqi mobile number is refused: short, long, landline, another country, no prefix, letters', () => {
  for (const typed of [
    '123456',
    '0770 123 456',
    '0770 123 45678',
    '01 234 5678', // a Baghdad landline (OPEN_QUESTIONS 33: mobiles only)
    '+964 1 234 5678',
    '0660 123 4567', // ten digits after 0, but not a 7
    '7701234567', // no 0 or 964 in front
    '+964 0770 123 4567',
    '+1 202 555 0100',
    '+44 7700 900123',
    '0770 123 4567 ext 2',
    '0770-ABC-4567',
    '++9647701234567',
    '',
  ]) {
    assert.equal(canonicalIraqiMobile(typed), null, typed);
  }
});

test('a valid body: the name made tidy, the phone kept as typed beside its canonical form, empty extras null', () => {
  const value = accepted(body({ buyer: { name: '  Ali   Hassan ', phone: ' +964 770 123 4567 ', landmark: '   ', notes: '' } }));
  assert.deepEqual(value, {
    checkout_id: CHECKOUT,
    locale: 'en',
    buyer: {
      name: 'Ali Hassan',
      phone: '+964 770 123 4567',
      phone_canonical: '9647701234567',
      city: { code: 'baghdad', en: 'Baghdad', ar: 'بغداد' },
      address: 'Karrada, street 62, house 14',
      landmark: null,
      notes: null,
    },
    lines: [{ item_id: LAMP, quantity: '2' }],
  });
});

test('ids are read in lower case; a quantity may be a number or a decimal string with four decimals', () => {
  const value = accepted(body({ checkout_id: CHECKOUT.toUpperCase(), lines: [{ item_id: LAMP.toUpperCase(), quantity: 1.5 }, { item_id: SHIRT_S, quantity: '0.0001' }] }));
  assert.equal(value.checkout_id, CHECKOUT);
  assert.deepEqual(value.lines, [{ item_id: LAMP, quantity: '1.5' }, { item_id: SHIRT_S, quantity: '0.0001' }]);
  assert.equal(accepted(body({ buyer: { landmark: 'Near the Karrada mosque', notes: 'Call before noon.\nSecond floor.' } })).buyer.notes, 'Call before noon.\nSecond floor.');
});

test('on an Arabic page a six-digit phone and a city not in the list answer in Arabic', () => {
  const fields = fieldErrors(body({ locale: 'ar', buyer: { phone: '123456', city: 'paris' } }));
  assert.deepEqual(fields, { 'buyer.phone': MESSAGES.ar.phone, 'buyer.city': MESSAGES.ar.city });
  assert.equal(fields['buyer.city'], 'اختر مدينة التوصيل.');
  assert.match(fields['buyer.phone'], /^أدخل رقم هاتف محمول عراقي/);
});

test('the field errors follow the page\'s language, else the site\'s default, else English', () => {
  assert.deepEqual(fieldErrors(body({ buyer: { name: '' } })), { 'buyer.name': 'Enter your full name.' });
  assert.deepEqual(fieldErrors(body({ locale: undefined, buyer: { name: '' } }), 'ar'), { 'buyer.name': 'أدخل اسمك الكامل.' });
  assert.deepEqual(fieldErrors(body({ locale: 'ku', buyer: { name: '' } }), 'ar'), { 'buyer.name': 'أدخل اسمك الكامل.' });
  assert.equal(checkoutLocale('fr', 'fr'), 'en');
  assert.equal(checkoutLocale('ar', 'en'), 'ar');
});

test('every length rule, at its bound and one past it', () => {
  const chars = (n: number) => 'ب'.repeat(n);
  assert.equal(accepted(body({ buyer: { name: chars(LIMITS.nameMin) } })).buyer.name, chars(2));
  assert.deepEqual(fieldErrors(body({ buyer: { name: 'ع' } })), { 'buyer.name': MESSAGES.en.name });
  // Two words, so that only the whole name's length is in question (a word of more than 100 characters is the next test's).
  const words = (total: number) => `${chars(40)} ${chars(total - 41)}`;
  assert.equal(Array.from(accepted(body({ buyer: { name: words(LIMITS.nameMax) } })).buyer.name).length, LIMITS.nameMax);
  assert.deepEqual(fieldErrors(body({ buyer: { name: words(LIMITS.nameMax + 1) } })), { 'buyer.name': MESSAGES.en.nameTooLong });
  accepted(body({ buyer: { address: chars(LIMITS.addressMin) } }));
  assert.deepEqual(fieldErrors(body({ buyer: { address: chars(LIMITS.addressMin - 1) } })), { 'buyer.address': MESSAGES.en.address });
  accepted(body({ buyer: { address: chars(LIMITS.addressMax) } }));
  assert.deepEqual(fieldErrors(body({ buyer: { address: chars(LIMITS.addressMax + 1) } })), { 'buyer.address': MESSAGES.en.addressTooLong });
  accepted(body({ buyer: { landmark: chars(LIMITS.landmarkMax) } }));
  assert.deepEqual(fieldErrors(body({ buyer: { landmark: chars(LIMITS.landmarkMax + 1) } })), { 'buyer.landmark': MESSAGES.en.landmarkTooLong });
  accepted(body({ buyer: { notes: chars(LIMITS.notesMax) } }));
  assert.deepEqual(fieldErrors(body({ buyer: { notes: chars(LIMITS.notesMax + 1) } })), { 'buyer.notes': MESSAGES.en.notesTooLong });
  // A phone longer than Sales keeps is refused even when its digits would do.
  assert.deepEqual(fieldErrors(body({ buyer: { phone: `0770${' '.repeat(LIMITS.phoneMax)}1234567` } })), { 'buyer.phone': MESSAGES.en.phone });
});

test('the first word and the rest of the name are each at most 100 characters, as Contact Center takes them (OPEN_QUESTIONS 37)', () => {
  const chars = (n: number) => 'ب'.repeat(n);
  const first = LIMITS.namePartMax;
  // The first word: 100 pass, 101 do not, though the whole name is within 120.
  assert.equal(accepted(body({ buyer: { name: `${chars(first)} ${chars(10)}` } })).buyer.name, `${chars(first)} ${chars(10)}`);
  assert.equal(accepted(body({ buyer: { name: chars(first) } })).buyer.name, chars(first));
  assert.deepEqual(fieldErrors(body({ buyer: { name: chars(first + 1) } })), { 'buyer.name': MESSAGES.en.namePartTooLong });
  assert.deepEqual(fieldErrors(body({ buyer: { name: `${chars(first + 1)} ${chars(10)}` } })), { 'buyer.name': MESSAGES.en.namePartTooLong });
  // The rest, every word after the first with single spaces: 100 pass, 101 do not.
  const rest = (n: number) => `${chars(30)} ${chars(30)} ${chars(n - 62)}`; // 30 + 1 + 30 + 1 + (n - 62) = n
  assert.equal(accepted(body({ buyer: { name: `Ali ${rest(first)}` } })).buyer.name, `Ali ${rest(first)}`);
  assert.deepEqual(fieldErrors(body({ buyer: { name: `Ali ${rest(first + 1)}` } })), { 'buyer.name': MESSAGES.en.namePartTooLong });
  // Spaces count as the parser makes them: a run of spaces is one, and the name is trimmed first.
  accepted(body({ buyer: { name: `  Ali   ${chars(first)}  ` } }));
  assert.deepEqual(fieldErrors(body({ buyer: { name: `  Ali   ${chars(first + 1)}  ` } })), { 'buyer.name': MESSAGES.en.namePartTooLong });
  // A name over 120 characters is the whole-name error, not this one.
  assert.deepEqual(fieldErrors(body({ buyer: { name: `${chars(first + 1)} ${chars(30)}` } })), { 'buyer.name': MESSAGES.en.nameTooLong });
});

test('a name part counts in UTF-16 units, the way Contact Center counts it, so a name it would refuse is refused here', () => {
  // 51 emoji are 51 characters but 102 units: the first word is too long for Contact Center's VARCHAR(100) check.
  const emoji = '😀'.repeat(51);
  assert.deepEqual(fieldErrors(body({ buyer: { name: `${emoji} Ali` } })), { 'buyer.name': MESSAGES.en.namePartTooLong });
  accepted(body({ buyer: { name: `${'😀'.repeat(50)} Ali` } }));
});

test('the name-part error is worded in the page\'s language', () => {
  const tooLong = `${'ب'.repeat(LIMITS.namePartMax + 1)} علي`;
  assert.deepEqual(fieldErrors(body({ locale: 'ar', buyer: { name: tooLong } })), { 'buyer.name': MESSAGES.ar.namePartTooLong });
  assert.match(MESSAGES.ar.namePartTooLong, /^اختصر الاسم/);
  assert.match(MESSAGES.ar.namePartTooLong, /100/);
  assert.match(MESSAGES.en.namePartTooLong, /first word/);
  assert.match(MESSAGES.en.namePartTooLong, /100/);
});

test('one to fifty lines, each an item id and a quantity above zero', () => {
  const line = { item_id: LAMP, quantity: '1' };
  assert.deepEqual(fieldErrors(body({ lines: [] })), { lines: MESSAGES.en.emptyCart });
  assert.equal(accepted(body({ lines: Array.from({ length: LIMITS.linesMax }, () => line) })).lines.length, 50);
  assert.deepEqual(fieldErrors(body({ lines: Array.from({ length: LIMITS.linesMax + 1 }, () => line) })), { lines: MESSAGES.en.tooManyLines });
  for (const quantity of ['0', '0.0', 0, -1, '-1', '1.23456', '1e3', 1e21, '', null, '1234567890123']) {
    assert.deepEqual(fieldErrors(body({ lines: [{ item_id: LAMP, quantity }] })), { 'lines.0.quantity': MESSAGES.en.quantity }, String(quantity));
  }
  assert.deepEqual(fieldErrors(body({ lines: [line, { item_id: 'lamp', quantity: '1' }] })), { 'lines.1.item_id': MESSAGES.en.item });
});

test('a checkout id that is not a uuid is a field error: the page must make a new one', () => {
  assert.deepEqual(fieldErrors(body({ checkout_id: 'cart-1' })), { checkout_id: MESSAGES.en.checkoutId });
  assert.deepEqual(fieldErrors(body({ checkout_id: undefined })), { checkout_id: MESSAGES.en.checkoutId });
});

test('a body the page could not have sent is invalid_body, naming what is wrong', () => {
  assert.equal(bodyError(null), 'The body must be a JSON object');
  assert.equal(bodyError([]), 'The body must be a JSON object');
  assert.equal(bodyError(body({ price: '100' })), 'Unknown field price');
  assert.equal(bodyError(body({ buyer: { email: 'a@b.c' } })), 'Unknown field buyer.email');
  assert.equal(bodyError(body({ lines: [{ item_id: LAMP, quantity: '1', unit_price: '1' }] })), 'Unknown field lines.0.unit_price');
  assert.equal(bodyError({ ...body(), buyer: 'Ali' }), 'buyer must be an object');
  assert.equal(bodyError(body({ lines: { item_id: LAMP } })), 'lines must be an array');
  assert.equal(bodyError(body({ lines: ['lamp'] })), 'lines.0 must be an object');
  assert.equal(bodyError(body({ buyer: { name: 42 } })), 'buyer.name must be a string');
  assert.equal(bodyError(body({ locale: 1 })), 'locale must be a string');
});

test('the cities are Iraq\'s nineteen governorates, Halabja after Sulaymaniyah, each with an Arabic and an English name', () => {
  assert.equal(IRAQ_GOVERNORATES.length, 19);
  assert.equal(new Set(IRAQ_GOVERNORATES.map((g) => g.code)).size, 19);
  const codes = IRAQ_GOVERNORATES.map((g) => g.code);
  assert.equal(codes.indexOf('halabja'), codes.indexOf('sulaymaniyah') + 1);
  assert.deepEqual(governorateByCode('halabja'), { code: 'halabja', en: 'Halabja', ar: 'حلبجة' });
  assert.equal(governorateByCode('Baghdad'), undefined);
  for (const g of IRAQ_GOVERNORATES) {
    assert.match(g.ar, /^[؀-ۿ ]+$/, g.code);
    assert.match(g.en, /^[A-Za-z' -]+$/, g.code);
  }
});
