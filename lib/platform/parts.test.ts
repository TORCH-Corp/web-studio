import assert from 'node:assert/strict';
import { test } from 'node:test';

import { isHiddenBuilderRoute, partsRaised } from './parts';

test('only WS_PARTS=1 raises the parts', () => {
  assert.equal(partsRaised({}), false);
  assert.equal(partsRaised({ WS_PARTS: '0' }), false);
  assert.equal(partsRaised({ WS_PARTS: 'true' }), false);
  assert.equal(partsRaised({ WS_PARTS: '1' }), true);
});

test('the removed screens are 404 with the flag up or down', () => {
  for (const parts of [false, true]) {
    for (const path of ['/ycode/settings/users', '/ycode/profile', '/ycode/profile/', '/ycode/accept-invite', '/ycode/welcome', '/ycode/settings/users/x']) {
      assert.equal(isHiddenBuilderRoute(path, parts), true, `${path} (parts ${parts})`);
    }
  }
});

test('Collections and Forms are 404 until the flag is up', () => {
  for (const path of ['/ycode/collections', '/ycode/collections/abc', '/ycode/forms', '/ycode/forms/']) {
    assert.equal(isHiddenBuilderRoute(path, false), true, path);
    assert.equal(isHiddenBuilderRoute(path, true), false, path);
  }
});

test('the screens that stay are not hidden', () => {
  for (const path of ['/ycode', '/ycode/pages/1', '/ycode/settings/general', '/ycode/settings/agent', '/ycode/integrations/mcp', '/ycode/integrations/apps', '/ycode/localization', '/ycode/settings', '/ycode/profiles', '/ycode/formsx']) {
    assert.equal(isHiddenBuilderRoute(path, false), false, path);
  }
});
