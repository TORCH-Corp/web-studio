import assert from 'node:assert/strict';
import { test } from 'node:test';

import { formatPrice, groupAmount } from './format';

test('thousands are grouped with a comma and the decimals are kept exactly', () => {
  assert.equal(groupAmount('25000'), '25,000');
  assert.equal(groupAmount('1250000'), '1,250,000');
  assert.equal(groupAmount('999'), '999');
  assert.equal(groupAmount('0'), '0');
  assert.equal(groupAmount('12.50'), '12.50');
  assert.equal(groupAmount('12345.6789'), '12,345.6789');
  assert.equal(groupAmount('not a number'), 'not a number');
  assert.equal(groupAmount('-5'), '-5');
});

test('a price is the amount and the currency in the page\'s language, as the handoff writes it', () => {
  assert.equal(formatPrice({ amount: '25000', currency: 'IQD' }, 'en'), '25,000 IQD');
  assert.equal(formatPrice({ amount: '25000', currency: 'IQD' }, 'ar'), '25,000 د.ع');
  assert.equal(formatPrice({ amount: '12.50', currency: 'USD' }, 'en'), '12.50 USD');
  assert.equal(formatPrice({ amount: '12.50', currency: 'USD' }, 'ar'), '12.50 $');
});
