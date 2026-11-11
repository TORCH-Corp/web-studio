import assert from 'node:assert/strict';
import { test } from 'node:test';

import { formatPrice, groupAmount, moneyText, optionsText, quantityText, unitText } from './format';

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

test('an amount from Sales loses the zeros it keeps for decimals, down to the currency\'s precision, and never a digit that counts', () => {
  assert.equal(moneyText({ amount: '5000.00', currency: 'IQD' }, 'en'), '5,000 IQD');
  assert.equal(moneyText({ amount: '115000.0000', currency: 'IQD' }, 'ar'), '115,000 د.ع');
  assert.equal(moneyText({ amount: '25000', currency: 'IQD' }, 'en'), '25,000 IQD');
  assert.equal(moneyText({ amount: '12.5', currency: 'USD' }, 'en'), '12.50 USD');
  assert.equal(moneyText({ amount: '12.5000', currency: 'USD' }, 'en'), '12.50 USD');
  assert.equal(moneyText({ amount: '40', currency: 'USD' }, 'en'), '40.00 USD');
  assert.equal(moneyText({ amount: '12.3456', currency: 'USD' }, 'en'), '12.3456 USD');
  assert.equal(moneyText({ amount: '1000.5', currency: 'IQD' }, 'en'), '1,000.5 IQD', 'a real decimal of a dinar price is kept');
  assert.equal(moneyText({ amount: '0.00', currency: 'IQD' }, 'en'), '0 IQD', 'a free delivery');
});

test('a quantity from Sales is read without its trailing zeros', () => {
  assert.equal(quantityText('2'), '2');
  assert.equal(quantityText('2.0000'), '2');
  assert.equal(quantityText('1.5000'), '1.5');
  assert.equal(quantityText('10'), '10');
  assert.equal(quantityText('x'), 'x');
});

test('the options of a variant read "Colour: Black · Size: M" in each language, the Arabic label when there is one', () => {
  const axes = [
    { name: 'Colour', name_ar: 'اللون', option: 'Black', option_ar: 'أسود' },
    { name: 'Size', name_ar: null, option: 'M', option_ar: null },
  ];
  assert.equal(optionsText(axes, 'en'), 'Colour: Black · Size: M');
  assert.equal(optionsText(axes, 'ar'), 'اللون: أسود · Size: M');
  assert.equal(optionsText([], 'en'), '');
});

test('a unit is shown by its name, never its symbol: "Each", not "ea" (OPEN_QUESTIONS 68); the symbol only when the unit has no name', () => {
  assert.equal(unitText({ name: 'Each', symbol: 'ea' }), 'Each');
  assert.equal(unitText({ name: 'Piece', symbol: 'pcs' }), 'Piece');
  assert.equal(unitText({ name: 'Piece', symbol: '' }), 'Piece');
  assert.equal(unitText({ name: 'Piece' }), 'Piece');
  assert.equal(unitText({ name: '', symbol: 'ea' }), 'ea');
  assert.equal(unitText(null), null);
});
