import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ContactCenterUnavailableError, findOrCreatePerson } from './contact-center';

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
