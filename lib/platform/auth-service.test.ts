import assert from 'node:assert/strict';
import { test } from 'node:test';

import { authServiceUrl, displayName, hasAnyPermission, permissionsFromLeafMap } from './auth-service';

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
