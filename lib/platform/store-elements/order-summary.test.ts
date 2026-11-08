import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { CartLine } from './cart-store';
import { summarise } from './order-summary';

const line = (item_id: string, amount: string, quantity: number, currency: 'IQD' | 'USD' = 'IQD'): CartLine => ({
  item_id,
  product_id: item_id,
  quantity,
  snapshot: { name: item_id, name_ar: null, axes: [], price: { amount, currency }, image: null, unit: null },
});

test('the summary is the lines\' totals, their sum, the delivery fee and the total, exactly', () => {
  const summary = summarise([line('tee', '25000', 2), line('hoodie', '45000', 1), line('tote', '15000', 1)], { currency: 'IQD', delivery_fee: '5000.00' });
  assert.equal(summary.kind, 'ready');
  if (summary.kind !== 'ready') return;
  assert.deepEqual(summary.lines.map((row) => row.total.amount), ['50000', '45000', '15000']);
  assert.equal(summary.subtotal.amount, '110000');
  assert.equal(summary.fee.amount, '5000.00');
  assert.equal(summary.total.amount, '115000.00');
  assert.equal(summary.count, 4);
  assert.equal(summary.total.currency, 'IQD');
});

test('decimals add up without a float: 3 × 0.1 and 0.2 are 0.5', () => {
  const summary = summarise([line('a', '0.1', 3, 'USD')], { currency: 'USD', delivery_fee: '0.20' });
  assert.equal(summary.kind === 'ready' && summary.total.amount, '0.50');
});

test('free delivery is a fee of zero, and the total is the subtotal', () => {
  const summary = summarise([line('a', '1500', 2)], { currency: 'IQD', delivery_fee: '0.00' });
  assert.equal(summary.kind === 'ready' && summary.total.amount, '3000.00');
});

test('an empty cart has no summary', () => {
  assert.deepEqual(summarise([], { currency: 'IQD', delivery_fee: '0.00' }), { kind: 'empty' });
});

test('a line in another currency than the store\'s is stale: no amount is shown until it is read again', () => {
  assert.deepEqual(summarise([line('a', '1500', 1), line('b', '10', 1, 'USD')], { currency: 'IQD', delivery_fee: '0' }), { kind: 'stale' });
  assert.deepEqual(summarise([line('b', '10', 1, 'USD')], { currency: 'IQD', delivery_fee: '0' }), { kind: 'stale' });
});
