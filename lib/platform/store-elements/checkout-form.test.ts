import assert from 'node:assert/strict';
import { test } from 'node:test';

import { checkoutBody, EMPTY_FORM, formErrors, invalidFields } from './checkout-form';
import { parseCheckout } from '../checkout-input';

const LINE = (item_id: string, quantity: number) => ({
  item_id,
  product_id: item_id,
  quantity,
  snapshot: { name: 'x', name_ar: null, axes: [], price: { amount: '1', currency: 'IQD' as const }, image: null, unit: null },
});

test('the body is what the route takes: the typed values, the lines with their quantities as text, and the page\'s language', () => {
  const ID = '0b3f6f0e-2a53-4b8a-8f3a-6a0d5d1f5a11';
  const ITEM = '48484848-9999-4848-8848-484848484848';
  const values = { ...EMPTY_FORM, name: 'علي حسن', phone: '0770 123 4567', city: 'baghdad', address: 'الكرادة، شارع 62، دار 14' };
  const body = checkoutBody({ checkoutId: ID, values, lines: [LINE(ITEM, 3)], lang: 'ar' });
  assert.deepEqual(body, {
    checkout_id: ID,
    buyer: { name: 'علي حسن', phone: '0770 123 4567', city: 'baghdad', address: 'الكرادة، شارع 62، دار 14', landmark: '', notes: '' },
    lines: [{ item_id: ITEM, quantity: '3' }],
    locale: 'ar',
  });
  // And the route accepts it as it is: no key it would refuse, none it would drop.
  const parsed = parseCheckout(body, 'ar');
  assert.equal(parsed.ok, true);
});

test('the route\'s field errors go under their fields; what is about the order as a whole is kept apart, once each', () => {
  const errors = formErrors({
    'buyer.name': 'Enter your full name.',
    'buyer.city': 'Choose your delivery city.',
    'buyer.phone': 'Enter an Iraqi mobile number, such as 0770 123 4567 or +964 770 123 4567.',
    lines: 'Your cart is empty.',
    'lines.0.item_id': 'This item is not in the store.',
    'lines.1.item_id': 'This item is not in the store.',
    checkout_id: 'Reload the page and try again.',
  });
  assert.equal(errors.fields.name, 'Enter your full name.');
  assert.equal(errors.fields.address, undefined);
  assert.deepEqual(errors.general, ['Your cart is empty.', 'This item is not in the store.', 'Reload the page and try again.']);
  assert.deepEqual(invalidFields(errors), ['name', 'phone', 'city'], 'in the form\'s order, not the route\'s');
});

test('a field the form does not have is not lost: it is shown with the general errors', () => {
  const errors = formErrors({ 'buyer.fax': 'Unknown' });
  assert.deepEqual(errors.fields, {});
  assert.deepEqual(errors.general, ['Unknown']);
});

test('the decoy field is sent only when something filled it, and the route takes it for spam without reading the rest', () => {
  const base = { checkoutId: '0b3f6f0e-2a53-4b8a-8f3a-6a0d5d1f5a11', values: EMPTY_FORM, lines: [LINE('x', 1)], lang: 'en' as const };
  assert.equal('ycode_hp' in checkoutBody(base), false);
  assert.equal('ycode_hp' in checkoutBody({ ...base, honeypot: '' }), false);
  assert.equal(checkoutBody({ ...base, honeypot: 'http://spam' }).ycode_hp, 'http://spam');
});
