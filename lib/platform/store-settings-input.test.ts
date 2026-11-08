import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DEFAULT_STORE, normaliseFee, parseStorePatch, planStorePatch, type StorePatch, type StoreRow } from './store-settings-input';

const BRANCH = '1b1b1b1b-1b1b-4b1b-8b1b-1b1b1b1b1b1b';
const OTHER_BRANCH = '2b2b2b2b-2b2b-4b2b-8b2b-2b2b2b2b2b2b';
const KITCHEN = '3c3c3c3c-3c3c-4c3c-8c3c-3c3c3c3c3c3c';
const GARDEN = '4c4c4c4c-4c4c-4c4c-8c4c-4c4c4c4c4c4c';

const patchOf = (body: unknown): StorePatch => {
  const { patch, errors } = parseStorePatch(body);
  assert.ok(patch, `expected a valid patch, got ${JSON.stringify(errors)}`);
  return patch;
};
const errorsOf = (body: unknown): string[] => {
  const { patch, errors } = parseStorePatch(body);
  assert.equal(patch, null, 'expected the body to be refused');
  return errors!;
};
const selling: StoreRow = { selling: true, currency: 'IQD', branch_id: BRANCH, category_ids: [KITCHEN], delivery_fee: '2500.00' };

test('the fee is zero or more with at most two decimals, kept as a string with two places', () => {
  assert.equal(normaliseFee(0), '0.00');
  assert.equal(normaliseFee(2500), '2500.00');
  assert.equal(normaliseFee(12.5), '12.50');
  assert.equal(normaliseFee('12.5'), '12.50');
  assert.equal(normaliseFee(' 007.25 '), '7.25');
  assert.equal(normaliseFee('999999999999.99'), '999999999999.99');
  assert.equal(normaliseFee(-1), null);
  assert.equal(normaliseFee('-0.01'), null);
  assert.equal(normaliseFee(1.005), null);
  assert.equal(normaliseFee('1.005'), null);
  assert.equal(normaliseFee('1000000000000'), null, 'thirteen digits do not fit numeric(14,2)');
  assert.equal(normaliseFee(1e21), null);
  assert.equal(normaliseFee(Number.NaN), null);
  assert.equal(normaliseFee('12,5'), null);
  assert.equal(normaliseFee(''), null);
  assert.equal(normaliseFee('.5'), null);
});

test('a patch names only what it changes; every field is optional', () => {
  assert.deepEqual(patchOf({}), {});
  assert.deepEqual(patchOf({ delivery_fee: 3000 }), { delivery_fee: '3000.00' });
  assert.deepEqual(patchOf({ branch_id: null }), { branch_id: null });
  assert.deepEqual(
    patchOf({ selling: true, currency: 'USD', branch_id: BRANCH.toUpperCase(), category_ids: [KITCHEN, KITCHEN.toUpperCase(), GARDEN], delivery_fee: '4.5' }),
    { selling: true, currency: 'USD', branch_id: BRANCH, category_ids: [KITCHEN, GARDEN], delivery_fee: '4.50' },
  );
});

test('a bad body is refused with each field named', () => {
  assert.ok(errorsOf({ currency: 'EUR' }).some((e) => e.startsWith('currency')));
  assert.ok(errorsOf({ delivery_fee: -5 }).some((e) => e.startsWith('delivery_fee')));
  assert.ok(errorsOf({ delivery_fee: '1.234' }).some((e) => e.startsWith('delivery_fee')));
  assert.ok(errorsOf({ branch_id: 'karrada' }).some((e) => e.startsWith('branch_id')));
  assert.ok(errorsOf({ category_ids: ['kitchen'] }).some((e) => e.startsWith('category_ids')));
  assert.ok(errorsOf({ category_ids: Array.from({ length: 201 }, (_, i) => `${String(i).padStart(8, '0')}-0000-4000-8000-000000000000`) }).length >= 1);
  assert.ok(errorsOf({ selling: 'yes' }).some((e) => e.startsWith('selling')));
  assert.ok(errorsOf({ payment_methods: ['card'] }).length >= 1, 'unknown keys are refused, not dropped');
  assert.ok(errorsOf('not an object').length >= 1);
  assert.equal(errorsOf({ currency: 'EUR', delivery_fee: -1, colour: 'red' }).length, 3);
});

test('selling cannot be switched on without a branch, nor the branch cleared while selling', () => {
  const on = planStorePatch(DEFAULT_STORE, patchOf({ selling: true }));
  assert.ok('error' in on);
  assert.equal(on.error.code, 'branch_required');
  assert.equal(on.error.field, 'branch_id');

  const cleared = planStorePatch(selling, patchOf({ branch_id: null }));
  assert.ok('error' in cleared && cleared.error.code === 'branch_required');

  const both = planStorePatch(DEFAULT_STORE, patchOf({ selling: true, branch_id: BRANCH }));
  assert.ok(!('error' in both));
  assert.equal(both.next.selling, true);
  assert.equal(both.checkBranch, BRANCH);

  const stopAndClear = planStorePatch(selling, patchOf({ selling: false, branch_id: null }));
  assert.ok(!('error' in stopAndClear));
  assert.deepEqual(stopAndClear.changes, { selling: false, branch_id: null });
  assert.equal(stopAndClear.checkBranch, null);
});

test('a currency change needs the fee in the same patch', () => {
  const alone = planStorePatch(selling, patchOf({ currency: 'USD' }));
  assert.ok('error' in alone);
  assert.equal(alone.error.code, 'fee_required');
  assert.equal(alone.error.field, 'delivery_fee');

  const withFee = planStorePatch(selling, patchOf({ currency: 'USD', delivery_fee: 2 }));
  assert.ok(!('error' in withFee));
  assert.deepEqual(withFee.changes, { currency: 'USD', delivery_fee: '2.00' });

  // The same fee, sent again with the new currency, is the owner confirming it.
  const sameFee = planStorePatch(selling, patchOf({ currency: 'USD', delivery_fee: '2500' }));
  assert.ok(!('error' in sameFee));
  assert.deepEqual(sameFee.changes, { currency: 'USD' });

  // The stored currency sent back is no change.
  const unchanged = planStorePatch(selling, patchOf({ currency: 'IQD' }));
  assert.ok(!('error' in unchanged));
  assert.deepEqual(unchanged.changes, {});
});

test('only what changes is checked: a new branch, the branch when selling is switched on, new categories', () => {
  // The whole form sent back unchanged: nothing to check, nothing to write.
  const resent = planStorePatch(selling, patchOf({ selling: true, currency: 'IQD', branch_id: BRANCH, category_ids: [KITCHEN], delivery_fee: 2500 }));
  assert.ok(!('error' in resent));
  assert.deepEqual(resent.changes, {});
  assert.equal(resent.checkBranch, null);
  assert.deepEqual(resent.checkCategories, []);

  // The fee changes while the stored branch and category stay as they are (they may be unavailable now).
  const fee = planStorePatch(selling, patchOf({ selling: true, branch_id: BRANCH, category_ids: [KITCHEN], delivery_fee: 3000 }));
  assert.ok(!('error' in fee));
  assert.deepEqual(fee.changes, { delivery_fee: '3000.00' });
  assert.equal(fee.checkBranch, null);
  assert.deepEqual(fee.checkCategories, []);

  // A new branch is checked, selling or not.
  const moved = planStorePatch({ ...DEFAULT_STORE, branch_id: BRANCH }, patchOf({ branch_id: OTHER_BRANCH }));
  assert.ok(!('error' in moved));
  assert.equal(moved.checkBranch, OTHER_BRANCH);

  // Switching selling on checks the stored branch: it may have been archived since it was chosen.
  const switchedOn = planStorePatch({ ...DEFAULT_STORE, branch_id: BRANCH }, patchOf({ selling: true }));
  assert.ok(!('error' in switchedOn));
  assert.equal(switchedOn.checkBranch, BRANCH);

  // Only the categories new to the site are checked; one removed is not.
  const categories = planStorePatch(selling, patchOf({ category_ids: [GARDEN, KITCHEN] }));
  assert.ok(!('error' in categories));
  assert.deepEqual(categories.checkCategories, [GARDEN]);
  assert.deepEqual(categories.changes, { category_ids: [GARDEN, KITCHEN] });

  const none = planStorePatch(selling, patchOf({ category_ids: [] }));
  assert.ok(!('error' in none));
  assert.deepEqual(none.changes, { category_ids: [] });
  assert.deepEqual(none.checkCategories, []);
});

test('the same categories in another order are no change', () => {
  const two: StoreRow = { ...DEFAULT_STORE, category_ids: [KITCHEN, GARDEN] };
  const reordered = planStorePatch(two, patchOf({ category_ids: [GARDEN, KITCHEN] }));
  assert.ok(!('error' in reordered));
  assert.deepEqual(reordered.changes, {});
});
