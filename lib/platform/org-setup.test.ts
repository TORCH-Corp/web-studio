import assert from 'node:assert/strict';
import { test } from 'node:test';

import { findBranches, listBranches, OrgSetupUnavailableError } from './org-setup';

const ENV = { ORG_SETUP_URL: 'http://auth-service:6001/', ORG_SETUP_API_KEY: 'k' };
const ORG = '0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a';
const OTHER_ORG = '0b0b0b0b-0b0b-4b0b-8b0b-0b0b0b0b0b0b';
const answer = (status: number, body: unknown) => (async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })) as unknown as typeof fetch;
const branch = (id: string, name: string, extra: Record<string, unknown> = {}) => ({ id, name, code: 'BR', type: 'branch', status: 'active', entityId: ORG, phone: null, ...extra });

test('the branches are the organization\'s active ones, asked with the service key and the organization in the body', async () => {
  let seen: { url: string; method?: string; key: string | null; body: unknown } | null = null;
  const fetchImpl = (async (url: string, init: RequestInit) => {
    seen = { url, method: init.method, key: new Headers(init.headers).get('x-service-api-key'), body: JSON.parse(String(init.body)) };
    return new Response(JSON.stringify([branch('b1', 'Baghdad, Karrada', { type: 'hq' }), branch('b2', 'Basra warehouse', { type: 'warehouse' })]));
  }) as unknown as typeof fetch;
  const list = await listBranches(ORG, ENV, fetchImpl);
  assert.deepEqual(list.map((b) => [b.id, b.name, b.type]), [['b1', 'Baghdad, Karrada', 'hq'], ['b2', 'Basra warehouse', 'warehouse']]);
  assert.equal(seen!.url, 'http://auth-service:6001/api/internal/branches/');
  assert.equal(seen!.method, 'POST');
  assert.equal(seen!.key, 'k');
  assert.deepEqual(seen!.body, { entityId: ORG });
});

test('a row of another organization or not active is never listed', async () => {
  const list = await listBranches(ORG, ENV, answer(200, [branch('b1', 'Mine'), branch('b2', 'Theirs', { entityId: OTHER_ORG }), branch('b3', 'Old', { status: 'archived' })]));
  assert.deepEqual(list.map((b) => b.id), ['b1']);
});

test('by id, archived branches resolve and another organization\'s do not', async () => {
  let body: unknown;
  const fetchImpl = (async (url: string, init: RequestInit) => {
    assert.equal(url, 'http://auth-service:6001/api/internal/branches/by-ids');
    body = JSON.parse(String(init.body));
    return new Response(JSON.stringify({ branches: [branch('b1', 'Closed branch', { status: 'archived' }), branch('b2', 'Theirs', { entityId: OTHER_ORG })] }));
  }) as unknown as typeof fetch;
  const found = await findBranches(ORG, ['b1', 'b2', 'b1'], ENV, fetchImpl);
  assert.deepEqual(body, { branchIds: ['b1', 'b2'] });
  assert.deepEqual(found.map((b) => [b.id, b.status]), [['b1', 'archived']]);
  assert.deepEqual(await findBranches(ORG, [], ENV, answer(500, {})), [], 'no ids, no call');
});

test('Organization Setup that cannot be asked is an error that says why, never an empty list', async () => {
  await assert.rejects(listBranches(ORG, {}, answer(200, [])), (e: Error) => e instanceof OrgSetupUnavailableError && /not set/.test(e.message));
  await assert.rejects(listBranches(ORG, ENV, answer(401, { error: 'Unauthorized' })), (e: Error) => e instanceof OrgSetupUnavailableError && /answered 401/.test(e.message));
  await assert.rejects(listBranches(ORG, ENV, answer(502, '<html>Bad gateway</html>')), /answered 502/);
  await assert.rejects(listBranches(ORG, ENV, answer(200, '<html></html>')), /not JSON/);
  await assert.rejects(listBranches(ORG, ENV, answer(200, { data: [] })), /unexpected body/);
  await assert.rejects(listBranches(ORG, ENV, answer(200, [{ id: 'b1' }])), /no id, name or organization/);
  await assert.rejects(findBranches(ORG, ['b1'], ENV, answer(200, [])), /unexpected body/);
  const down = (async () => {
    throw new TypeError('fetch failed');
  }) as unknown as typeof fetch;
  await assert.rejects(listBranches(ORG, ENV, down), (e: Error) => e instanceof OrgSetupUnavailableError && /not reachable/.test(e.message));
});
