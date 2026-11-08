import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ContactCenterUnavailableError, findOrCreatePerson, lookupContacts } from './contact-center';

const ENV = { CONTACT_CENTER_URL: 'http://contact-center-service:6017/', CONTACT_CENTER_API_KEY: 'cc-key' };
const ORG = '0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a';
const PERSON = '1b1b1b1b-1b1b-4b1b-8b1b-1b1b1b1b1b1b';
const answer = (status: number, body: unknown) => (async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })) as unknown as typeof fetch;

test('the person is asked for with the service key, the organization, the name, the phone and the storefront origin', async () => {
  let seen: { url: string; method?: string; headers: Headers; body: unknown } | null = null;
  const fetchImpl = (async (url: string, init: RequestInit) => {
    seen = { url, method: init.method, headers: new Headers(init.headers), body: JSON.parse(String(init.body)) };
    return new Response(JSON.stringify({ person_id: PERSON.toUpperCase(), created: true }), { status: 201 });
  }) as unknown as typeof fetch;
  assert.deepEqual(await findOrCreatePerson(ORG, { name: 'Ali Hassan', phone: '9647701234567' }, ENV, fetchImpl), { personId: PERSON, created: true });
  assert.equal(seen!.url, 'http://contact-center-service:6017/api/v1/internal/persons/find-or-create');
  assert.equal(seen!.method, 'POST');
  assert.equal(seen!.headers.get('x-service-api-key'), 'cc-key');
  assert.equal(seen!.headers.get('x-entity-id'), ORG);
  assert.equal(seen!.headers.get('content-type'), 'application/json');
  assert.deepEqual(seen!.body, { name: 'Ali Hassan', phone: '9647701234567', origin: 'storefront' });
});

test('an existing person answers 200 with created false', async () => {
  assert.deepEqual(await findOrCreatePerson(ORG, { name: 'Ali', phone: '9647701234567' }, ENV, answer(200, { person_id: PERSON, created: false })), { personId: PERSON, created: false });
});

test('a refusal, a failure, an unexpected body, no answer or no configuration is ContactCenterUnavailableError', async () => {
  const buyer = { name: 'Ali', phone: '9647701234567' };
  for (const [status, body] of [[400, { message: 'phone must have 7 digits' }], [401, ''], [403, ''], [500, ''], [503, ''], [200, { person_id: 'x', created: false }], [201, { person_id: PERSON }], [200, 'not json']] as const) {
    await assert.rejects(findOrCreatePerson(ORG, buyer, ENV, answer(status, body)), ContactCenterUnavailableError, `${status} ${JSON.stringify(body)}`);
  }
  const down = (async () => {
    throw new TypeError('fetch failed');
  }) as unknown as typeof fetch;
  await assert.rejects(findOrCreatePerson(ORG, buyer, ENV, down), /not reachable.*fetch failed/);
  await assert.rejects(findOrCreatePerson(ORG, buyer, {}, answer(200, {})), /CONTACT_CENTER_URL and CONTACT_CENTER_API_KEY are not set/);
});

// ---------------------------------------------------------------------------
// The buyer's name and phone for the Orders list (part 2, session W8)
// ---------------------------------------------------------------------------

const idAt = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const entry = (id: string, over: Record<string, unknown> = {}) => ({
  id, entityKind: 'PERSON', name: `Buyer ${id.slice(-4)}`, code: 'PER-000001', primaryOrganizationId: null, primaryOrganizationName: null, phone: '9647701234567', email: null, status: 'ACTIVE', ...over,
});

test('the buyers are looked up by id with the service key and the organization, keyed by id', async () => {
  const seen: Array<{ url: string; method?: string; headers: Headers; body: { ids: string[] } }> = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as { ids: string[] };
    seen.push({ url, method: init.method, headers: new Headers(init.headers), body });
    return new Response(JSON.stringify({ success: true, data: Object.fromEntries(body.ids.filter((id) => id !== idAt(9)).map((id) => [id, entry(id)])) }));
  }) as unknown as typeof fetch;
  const found = await lookupContacts(ORG, [idAt(1), idAt(2), idAt(9), idAt(1)], ENV, fetchImpl);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, 'http://contact-center-service:6017/api/v1/directory/lookup-ids');
  assert.equal(seen[0].method, 'POST');
  assert.equal(seen[0].headers.get('x-service-api-key'), 'cc-key');
  assert.equal(seen[0].headers.get('x-entity-id'), ORG);
  assert.deepEqual(seen[0].body, { ids: [idAt(1), idAt(2), idAt(9)] }); // each id once
  assert.deepEqual([...found.keys()], [idAt(1), idAt(2)]); // a contact Contact Center does not have is absent
  assert.deepEqual(found.get(idAt(1)), { id: idAt(1), name: 'Buyer 0001', phone: '9647701234567', archived: false });
});

test('more than 100 ids are asked in chunks of 100', async () => {
  const sizes: number[] = [];
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    const { ids } = JSON.parse(String(init.body)) as { ids: string[] };
    sizes.push(ids.length);
    return new Response(JSON.stringify({ success: true, data: Object.fromEntries(ids.map((id) => [id, entry(id, { status: 'ARCHIVED', phone: null })])) }));
  }) as unknown as typeof fetch;
  const ids = Array.from({ length: 230 }, (_, i) => idAt(i + 1));
  const found = await lookupContacts(ORG, ids, ENV, fetchImpl);
  assert.deepEqual(sizes, [100, 100, 30]);
  assert.equal(found.size, 230);
  assert.deepEqual(found.get(idAt(230)), { id: idAt(230), name: 'Buyer 0230', phone: null, archived: true });
});

test('no ids ask nothing', async () => {
  const fetchImpl = (async () => {
    throw new Error('must not be called');
  }) as unknown as typeof fetch;
  assert.equal((await lookupContacts(ORG, [], ENV, fetchImpl)).size, 0);
});

test('a lookup that fails, answers badly, or has no configuration is ContactCenterUnavailableError', async () => {
  for (const [status, body] of [[401, ''], [403, ''], [500, ''], [503, ''], [200, 'not json'], [200, { success: true }], [200, { success: true, data: { [idAt(1)]: { id: idAt(1) } } }]] as const) {
    await assert.rejects(lookupContacts(ORG, [idAt(1)], ENV, answer(status, body)), ContactCenterUnavailableError, `${status} ${JSON.stringify(body)}`);
  }
  const down = (async () => {
    throw new TypeError('fetch failed');
  }) as unknown as typeof fetch;
  await assert.rejects(lookupContacts(ORG, [idAt(1)], ENV, down), /not reachable.*fetch failed/);
  await assert.rejects(lookupContacts(ORG, [idAt(1)], {}, answer(200, {})), /CONTACT_CENTER_URL and CONTACT_CENTER_API_KEY are not set/);
});
