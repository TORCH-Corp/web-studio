import assert from 'node:assert/strict';
import { test } from 'node:test';

import { findBranches, findUnits, listBranches, listMemberIds, OrgSetupUnavailableError, userHolds, usdIqdRate } from './org-setup';

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

test('the day\'s rate is USD to IQD, spot, asked with the service key and the organization', async () => {
  let seen: { url: string; method?: string; key: string | null; entity: string | null } | null = null;
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const headers = new Headers(init.headers);
    seen = { url, method: init.method, key: headers.get('x-service-api-key'), entity: headers.get('x-entity-id') };
    return new Response(JSON.stringify({ success: true, data: { found: true, rate_type: 'spot', rate: 1520, effective_date: '2026-10-17', source: 'manual' } }));
  }) as unknown as typeof fetch;
  assert.equal(await usdIqdRate(ORG, '2026-11-08', ENV, fetchImpl), '1520');
  assert.deepEqual(seen, {
    url: 'http://auth-service:6001/api/internal/org-setup/exchange-rates/as-of?from=USD&to=IQD&date=2026-11-08&rate_type=spot',
    method: 'GET',
    key: 'k',
    entity: ORG,
  });
  assert.equal(await usdIqdRate(ORG, '2026-11-08', ENV, answer(200, { success: true, data: { found: true, rate_type: 'spot', rate: 1310.25 } })), '1310.25');
});

test('no rate for the day is an answer (null), a rate of zero is no rate, a broken answer is an error', async () => {
  assert.equal(await usdIqdRate(ORG, '2026-11-08', ENV, answer(200, { success: true, data: { found: false, rate_type: 'spot', from: 'USD', to: 'IQD', as_of: '2026-11-08' } })), null);
  assert.equal(await usdIqdRate(ORG, '2026-11-08', ENV, answer(200, { success: true, data: { found: true, rate_type: 'spot', rate: 0 } })), null);
  await assert.rejects(usdIqdRate(ORG, '2026-11-08', ENV, answer(200, { success: true, data: { found: true, rate: 'many' } })), OrgSetupUnavailableError);
  await assert.rejects(usdIqdRate(ORG, '2026-11-08', ENV, answer(200, { data: {} })), OrgSetupUnavailableError);
  await assert.rejects(usdIqdRate(ORG, '2026-11-08', ENV, answer(503, 'down')), /answered 503/);
});

test('units are looked up by id in calls of 200, archived ones included, an unknown id absent', async () => {
  const calls: Array<{ ids: string[]; entity: string | null }> = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const ids = (JSON.parse(String(init.body)) as { ids: string[] }).ids;
    calls.push({ ids, entity: new Headers(init.headers).get('x-entity-id') });
    assert.equal(url, 'http://auth-service:6001/api/internal/org-setup/uoms/lookup');
    return new Response(JSON.stringify({ success: true, data: ids.filter((id) => id !== 'gone').map((id) => ({ id, code: 'UOM-1', symbol: 'pcs', name: `Unit ${id}`, status: id === 'u0' ? 'archived' : 'active' })) }));
  }) as unknown as typeof fetch;
  const ids = [...Array.from({ length: 250 }, (_, i) => `u${i}`), 'u0', 'gone'];
  const units = await findUnits(ORG, ids, ENV, fetchImpl);
  assert.deepEqual(calls.map((c) => [c.ids.length, c.entity]), [[200, ORG], [51, ORG]]);
  assert.equal(units.size, 250);
  assert.deepEqual(units.get('u0'), { id: 'u0', symbol: 'pcs', name: 'Unit u0' });
  assert.equal(units.has('gone'), false);
  assert.equal((await findUnits(ORG, [], ENV, fetchImpl)).size, 0);
  assert.equal(calls.length, 2, 'no ids, no call');
});

// ---------------------------------------------------------------------------
// Who may be told of a new submission (part 3, session W5)
// ---------------------------------------------------------------------------

const MEMBER_A = '3a3a3a3a-3a3a-4a3a-8a3a-3a3a3a3a3a3a';
const MEMBER_B = '3b3b3b3b-3b3b-4b3b-8b3b-3b3b3b3b3b3b';

test('the members are the organization\'s first ids, asked with the service key, the organization and the limit; a next cursor means there are more', async () => {
  let seen: { url: string; method?: string; headers: Headers; body: unknown } | null = null;
  const fetchImpl = (async (url: string, init: RequestInit) => {
    seen = { url, method: init.method, headers: new Headers(init.headers), body: JSON.parse(String(init.body)) };
    return new Response(JSON.stringify({ people: [{ id: MEMBER_A, displayName: 'A', avatarUrl: null }, { id: MEMBER_B, displayName: null, avatarUrl: null }], nextCursor: 'next' }));
  }) as unknown as typeof fetch;
  assert.deepEqual(await listMemberIds(ORG, 200, ENV, fetchImpl), { ids: [MEMBER_A, MEMBER_B], hasMore: true });
  assert.equal(seen!.url, 'http://auth-service:6001/api/internal/people/members');
  assert.equal(seen!.method, 'POST');
  assert.equal(seen!.headers.get('x-service-api-key'), 'k');
  assert.equal(seen!.headers.get('x-entity-id'), ORG);
  assert.deepEqual(seen!.body, { entityId: ORG, limit: 200 });
  const last = await listMemberIds(ORG, 200, ENV, answer(200, { people: [{ id: MEMBER_A }], nextCursor: null }));
  assert.deepEqual(last, { ids: [MEMBER_A], hasMore: false });
});

test('the members that cannot be read are an error that says why, never an empty list', async () => {
  await assert.rejects(listMemberIds(ORG, 200, {}, answer(200, {})), /not set/);
  await assert.rejects(listMemberIds(ORG, 200, ENV, answer(401, '')), /answered 401/);
  await assert.rejects(listMemberIds(ORG, 200, ENV, answer(200, { members: [] })), /unexpected body/);
  await assert.rejects(listMemberIds(ORG, 200, ENV, answer(200, { people: [{ displayName: 'no id' }], nextCursor: null })), /member that has no id/);
  await assert.rejects(listMemberIds(ORG, 501, ENV, answer(200, { people: [], nextCursor: null })), /at most 500/);
});

test('whether a user holds a flag is auth-service\'s evaluate, asked with the service key; only allowed true is yes', async () => {
  let seen: { url: string; method?: string; headers: Headers; body: unknown } | null = null;
  const fetchImpl = (async (url: string, init: RequestInit) => {
    seen = { url, method: init.method, headers: new Headers(init.headers), body: JSON.parse(String(init.body)) };
    return new Response(JSON.stringify({ allowed: true }));
  }) as unknown as typeof fetch;
  assert.equal(await userHolds(ORG, MEMBER_A, 'webstudio.manage_forms', 'r', ENV, fetchImpl), true);
  assert.equal(seen!.url, 'http://auth-service:6001/api/internal/authz/evaluate');
  assert.equal(seen!.method, 'POST');
  assert.equal(seen!.headers.get('x-service-api-key'), 'k');
  assert.deepEqual(seen!.body, { userId: MEMBER_A, entityId: ORG, leafKey: 'webstudio.manage_forms', flag: 'r' });
  assert.equal(await userHolds(ORG, MEMBER_A, 'webstudio.manage_forms', 'r', ENV, answer(200, { allowed: false })), false);
});

test('a check auth-service did not answer is an error, never a no: the member is not silently dropped', async () => {
  await assert.rejects(userHolds(ORG, MEMBER_A, 'webstudio.manage_forms', 'r', {}, answer(200, {})), /not set/);
  await assert.rejects(userHolds(ORG, MEMBER_A, 'webstudio.manage_forms', 'r', ENV, answer(401, '')), (e: Error) => e instanceof OrgSetupUnavailableError && /answered 401/.test(e.message));
  await assert.rejects(userHolds(ORG, MEMBER_A, 'webstudio.manage_forms', 'r', ENV, answer(200, { allowed: 'yes' })), /unexpected body/);
  await assert.rejects(userHolds(ORG, MEMBER_A, 'webstudio.manage_forms', 'r', ENV, answer(200, {})), /unexpected body/);
});
