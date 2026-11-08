import assert from 'node:assert/strict';
import { test } from 'node:test';

import { addAmounts, compareAmounts, convert, decimalFromNumber, displayAmount, isPositive, multiplyAmount, rateDay } from './store-money';

test('numbers from a JSON body become exact decimal strings, nothing negative or not finite', () => {
  assert.equal(decimalFromNumber(25000, 4), '25000');
  assert.equal(decimalFromNumber(12.5, 4), '12.5');
  assert.equal(decimalFromNumber(12.3456, 4), '12.3456');
  assert.equal(decimalFromNumber(0.1 + 0.2, 4), '0.3');
  assert.equal(decimalFromNumber(1310.25, 8), '1310.25');
  assert.equal(decimalFromNumber(0, 4), '0');
  assert.equal(decimalFromNumber(-1, 4), null);
  assert.equal(decimalFromNumber(Number.NaN, 4), null);
  assert.equal(decimalFromNumber('25000', 4), null);
  assert.equal(decimalFromNumber(null, 4), null);
});

test('a price shows at least its currency\'s decimals and keeps every digit it has', () => {
  assert.equal(displayAmount('25000', 'IQD'), '25000');
  assert.equal(displayAmount('25000.5', 'IQD'), '25000.5');
  assert.equal(displayAmount('12.5', 'USD'), '12.50');
  assert.equal(displayAmount('12', 'USD'), '12.00');
  assert.equal(displayAmount('12.3456', 'USD'), '12.3456');
});

test('USD to IQD multiplies by the day\'s rate and rounds half up to whole dinars', () => {
  assert.equal(convert('20', 'USD', 'IQD', '1520'), '30400');
  assert.equal(convert('12.3456', 'USD', 'IQD', '1310'), '16173'); // 16172.736
  assert.equal(convert('0.5', 'USD', 'IQD', '1'), '1'); // exactly half: up
  assert.equal(convert('10.25', 'USD', 'IQD', '1310.5'), '13433'); // 13432.625
});

test('IQD to USD divides by the same rate and rounds half up to cents', () => {
  assert.equal(convert('25000', 'IQD', 'USD', '1520'), '16.45'); // 16.4473…
  assert.equal(convert('30400', 'IQD', 'USD', '1520'), '20.00');
  assert.equal(convert('1', 'IQD', 'USD', '200'), '0.01'); // 0.005: up
  assert.equal(convert('25000.5', 'IQD', 'USD', '1310.25'), '19.08'); // 19.0807…
});

test('the same currency is not converted, and a rate of zero is refused', () => {
  assert.equal(convert('12.5', 'USD', 'USD', '1520'), '12.50');
  assert.throws(() => convert('1', 'USD', 'IQD', '0'), /zero/);
});

test('amounts compare by value whatever their decimals, and zero is not positive', () => {
  assert.equal(compareAmounts('30400', '35000'), -1);
  assert.equal(compareAmounts('20.00', '20'), 0);
  assert.equal(compareAmounts('20.01', '20'), 1);
  assert.equal(isPositive('0'), false);
  assert.equal(isPositive('0.0000'), false);
  assert.equal(isPositive('0.0001'), true);
});

test('the day of a rate is Baghdad\'s, whatever the server\'s zone', () => {
  assert.equal(rateDay(new Date('2026-11-08T20:59:59Z')), '2026-11-08');
  assert.equal(rateDay(new Date('2026-11-08T21:00:00Z')), '2026-11-09');
});

test('a price times a whole quantity and prices added together are exact, never a float', () => {
  assert.equal(multiplyAmount('25000', 3), '75000');
  assert.equal(multiplyAmount('12.50', 3), '37.50');
  assert.equal(multiplyAmount('0.1', 3), '0.3');
  assert.equal(multiplyAmount('19.99', 99), '1979.01');
  assert.equal(addAmounts('0.1', '0.2'), '0.3');
  assert.equal(addAmounts('25000', '12.50'), '25012.50');
  assert.equal(addAmounts('0', '0'), '0');
  assert.throws(() => multiplyAmount('25000', 1.5), /whole/);
  assert.throws(() => multiplyAmount('-1', 2), /decimal/);
});
