import assert from 'node:assert/strict';
import { test } from 'node:test';

import { guardsRequest } from './browser-session';

// The module is written for the browser; only the pure decision is tested here.
// The round trip with the shell is e2e/session.spec.ts.
(globalThis as { window?: unknown }).window ??= { location: { origin: 'http://127.0.0.1:3102' } };

test('only builder API requests are sent again after a renewal, never the session routes themselves', () => {
  assert.equal(guardsRequest('/ycode/api/pages'), true);
  assert.equal(guardsRequest('/ycode/api/pages?is_published=true'), true);
  assert.equal(guardsRequest(new URL('http://127.0.0.1:3102/ycode/api/layers')), true);
  assert.equal(guardsRequest('/ycode/api/auth/callback?token=x'), false);
  assert.equal(guardsRequest('/ycode/api/auth/session'), false);
  assert.equal(guardsRequest('/ycode/pages/abc'), false);
  assert.equal(guardsRequest('https://auth.torchcorp.com/authz/my-permissions'), false);
});

test('a request whose body cannot be read twice is not sent again', () => {
  assert.equal(guardsRequest('/ycode/api/assets/upload', { method: 'POST', body: new ReadableStream() }), false);
  assert.equal(guardsRequest('/ycode/api/assets', { method: 'POST', body: JSON.stringify({ filename: 'a.svg' }) }), true);
});
