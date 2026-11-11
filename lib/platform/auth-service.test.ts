import assert from 'node:assert/strict';
import { test } from 'node:test';

import { authServiceUrl, canExecuteSalesOrders, displayName, hasAnyPermission, permissionsFromLeafMap } from './auth-service';

test('a my-permissions map becomes the session\'s flags: webstudio leaves only, true flags only, known flags only', () => {
  const perms = permissionsFromLeafMap({
    'webstudio.manage_sites': { c: true, r: true, u: false, d: false, x: false, export: true, execute: { publish: true } },
    'webstudio.manage_content': { c: false, r: true, u: false, d: false, x: false, use_ai: true },
    'webstudio.manage_forms': { c: false, r: false, u: false, d: false, x: false },
    'webstudio.unknown_leaf': { c: true, r: true, u: true, d: true, x: true },
    'sales.manage_leads': { c: true, r: true, u: true, d: true, x: true },
  });
  assert.deepEqual(perms, {
    'webstudio.manage_sites': ['c', 'r', 'export'],
    'webstudio.manage_content': ['r', 'use_ai'],
  });
  assert.ok(hasAnyPermission(perms));
});

test('part 3, W1: the reports leaf is read at sign-in like the other four', () => {
  const perms = permissionsFromLeafMap({
    'webstudio.manage_reports': { c: false, r: true, u: false, d: false, x: false, export: false, use_ai: false },
    'webstudio.manage_forms': { c: false, r: true, u: false, d: false, x: false, export: false, use_ai: false },
  });
  assert.deepEqual(perms, { 'webstudio.manage_forms': ['r'], 'webstudio.manage_reports': ['r'] });
  assert.ok(hasAnyPermission(perms));
});

test('a map without webstudio leaves, or with every flag false, gives no permission', () => {
  assert.deepEqual(permissionsFromLeafMap({ 'sales.manage_leads': { c: true, r: true, u: true, d: true, x: true } }), {});
  assert.deepEqual(permissionsFromLeafMap({ 'webstudio.manage_sites': { c: false, r: false, u: false, d: false, x: false } }), {});
  assert.deepEqual(permissionsFromLeafMap(null), {});
  assert.deepEqual(permissionsFromLeafMap('nonsense'), {});
  assert.equal(hasAnyPermission({}), false);
});

test('the display name is the profile name, else first and last name, else the email', () => {
  assert.equal(displayName({ name: 'Mustafa M', firstName: 'X', lastName: 'Y', email: 'm@example.com' }), 'Mustafa M');
  assert.equal(displayName({ name: '  ', firstName: 'Ali', lastName: 'Nameer', email: 'a@example.com' }), 'Ali Nameer');
  assert.equal(displayName({ name: null, firstName: null, lastName: 'Nameer', email: 'a@example.com' }), 'Nameer');
  assert.equal(displayName({ name: null, firstName: null, lastName: null, email: 'a@example.com' }), 'a@example.com');
});

test('the auth-service URL defaults to the public host and loses a trailing slash', () => {
  assert.equal(authServiceUrl({}), 'https://auth.torchcorp.com');
  assert.equal(authServiceUrl({ BOS_AUTH_URL: 'http://auth-service:6001/' }), 'http://auth-service:6001');
});

test('the Sales flag is the x flag on sales.manage_orders and nothing else', () => {
  const flags = (over: Record<string, boolean>) => ({ c: false, r: false, u: false, d: false, x: false, ...over });
  assert.equal(canExecuteSalesOrders({ 'sales.manage_orders': flags({ r: true, x: true }) }), true);
  assert.equal(canExecuteSalesOrders({ 'sales.manage_orders': flags({ c: true, r: true, u: true, d: true, export: true }) }), false); // every flag but x
  assert.equal(canExecuteSalesOrders({ 'sales.manage_orders': { x: 'true' } }), false);
  assert.equal(canExecuteSalesOrders({ 'sales.manage_quotes': flags({ x: true }), 'webstudio.manage_orders': flags({ x: true }) }), false); // another leaf's x
  assert.equal(canExecuteSalesOrders({ 'sales.manage_orders': { execute: { confirm: true } } }), false);
  for (const map of [{}, null, undefined, 'nonsense', 7, [], { 'sales.manage_orders': null }]) assert.equal(canExecuteSalesOrders(map), false, JSON.stringify(map));
});
