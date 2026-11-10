import test from 'node:test';
import assert from 'node:assert/strict';
import { internalPathOf, isUnderPublicPrefix } from '@/lib/platform/public-path';

test('an API or layouts path under /studio maps onto /ycode', () => {
  assert.equal(internalPathOf('/studio/api/store/products'), '/ycode/api/store/products');
  assert.equal(internalPathOf('/studio/api/form-submissions'), '/ycode/api/form-submissions');
  assert.equal(internalPathOf('/studio/layouts/assets/placeholder-2.webp'), '/ycode/layouts/assets/placeholder-2.webp');
});

test('builder screens and other paths are not aliased', () => {
  assert.equal(internalPathOf('/studio'), null);
  assert.equal(internalPathOf('/studio/settings/general'), null);
  assert.equal(internalPathOf('/studio/preview/home'), null);
  assert.equal(internalPathOf('/studio/apix'), null);
  assert.equal(internalPathOf('/studios/api/x'), null);
  assert.equal(internalPathOf('/ycode/api/x'), null);
  assert.equal(internalPathOf('/products'), null);
});

test('everything under /studio is kept away from the sites\' pages', () => {
  assert.equal(isUnderPublicPrefix('/studio'), true);
  assert.equal(isUnderPublicPrefix('/studio/anything'), true);
  assert.equal(isUnderPublicPrefix('/studios'), false);
  assert.equal(isUnderPublicPrefix('/'), false);
});
