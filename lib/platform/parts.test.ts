import assert from 'node:assert/strict';
import fs from 'node:fs';
import nodePath from 'node:path';
import { test } from 'node:test';

import { HIDDEN_APP_IDS, isHiddenApp, isHiddenBuilderRoute } from './parts';

/** The ids in the app registry (read as text: the registry imports logos node cannot load). */
const registeredAppIds = [...fs.readFileSync(nodePath.join(__dirname, '../apps/registry.ts'), 'utf8').matchAll(/^\s{4}id: '([a-z-]+)',$/gm)].map((match) => match[1]);

test('the removed screens are 404', () => {
  for (const path of ['/ycode/settings/users', '/ycode/profile', '/ycode/profile/', '/ycode/accept-invite', '/ycode/welcome', '/ycode/settings/users/x']) {
    assert.equal(isHiddenBuilderRoute(path), true, path);
  }
});

test('Collections and Forms are always shown: no flag hides them', () => {
  for (const path of ['/ycode/collections', '/ycode/collections/abc', '/ycode/forms', '/ycode/forms/', '/ycode/api/collections', '/ycode/api/form-submissions']) {
    assert.equal(isHiddenBuilderRoute(path), false, path);
  }
});

test('the webhooks and API keys screens and their routes are 404, so no flag opens them', () => {
  for (const path of [
    '/ycode/integrations/webhooks',
    '/ycode/integrations/webhooks/',
    '/ycode/integrations/api',
    '/ycode/api/webhooks',
    '/ycode/api/webhooks/abc',
    '/ycode/api/webhooks/abc/deliveries',
    '/ycode/api/api-keys',
    '/ycode/api/api-keys/abc',
  ]) {
    assert.equal(isHiddenBuilderRoute(path), true, path);
  }
});

test('the connector apps and their routes are 404, with their generic settings route', () => {
  for (const id of ['airtable', 'webflow', 'mailerlite', 'mailchimp', 'zapier', 'make']) {
    assert.equal(isHiddenBuilderRoute(`/ycode/api/apps/${id}`), true, id);
    assert.equal(isHiddenBuilderRoute(`/ycode/api/apps/${id}/settings`), true, `${id}/settings`);
    assert.equal(isHiddenBuilderRoute(`/ycode/api/apps/${id}/connections/x`), true, `${id}/connections`);
    assert.equal(isHiddenApp(id), true, id);
  }
  assert.equal(isHiddenBuilderRoute('/ycode/api/apps/airtable/webhook/setup'), true);
});

test('hidden apps are exactly the registry apps that are not static export or a map', () => {
  assert.equal(registeredAppIds.length, 9, registeredAppIds.join(', '));
  assert.deepEqual(registeredAppIds.filter((id) => !isHiddenApp(id)).sort(), ['google-maps-embed', 'mapbox', 'static-export']);
  for (const id of HIDDEN_APP_IDS) assert.ok(registeredAppIds.includes(id), `${id} is a registered app`);
});

test('the screens that stay are not hidden', () => {
  for (const path of [
    '/ycode',
    '/ycode/pages/1',
    '/ycode/settings/general',
    '/ycode/settings/agent',
    '/ycode/integrations',
    '/ycode/integrations/mcp',
    '/ycode/integrations/apps',
    '/ycode/localization',
    '/ycode/settings',
    '/ycode/profiles',
    '/ycode/formsx',
    '/ycode/integrations/apikeys',
    '/ycode/api/apps',
    '/ycode/api/apps/static-export/export',
    '/ycode/api/apps/static-export/settings',
    '/ycode/api/apps/mapbox/settings',
    '/ycode/api/webhooksx',
    '/ycode/api/v1/forms',
  ]) {
    assert.equal(isHiddenBuilderRoute(path), false, path);
  }
});
