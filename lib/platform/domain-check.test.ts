import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DomainCheckUnavailableError, domainCheckMode, isVerifiedDomain, listVerifiedDomains } from './domain-check';

const ENV = { DOMAIN_SERVICE_URL: 'http://domain-service:6012/', DOMAIN_SERVICE_API_KEY: 'k' };
const ORG = '0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a';
const answer = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

test('the check is on unless WS_DOMAIN_CHECK is off', () => {
  assert.equal(domainCheckMode({}), 'on');
  assert.equal(domainCheckMode({ WS_DOMAIN_CHECK: 'on' }), 'on');
  assert.equal(domainCheckMode({ WS_DOMAIN_CHECK: 'false' }), 'on');
  assert.equal(domainCheckMode({ WS_DOMAIN_CHECK: ' OFF ' }), 'off');
});

test('the verified domains are the ACTIVE ones of the organization, asked with the service key', async () => {
  let seen: { url: string; key: string | null } | null = null;
  const fetchImpl = (async (url: string, init: RequestInit) => {
    seen = { url, key: new Headers(init.headers).get('x-service-api-key') };
    return new Response(JSON.stringify({ items: [{ name: 'Example.com', status: 'ACTIVE' }, { name: 'pending.com', status: 'PENDING' }, { name: 'example.com', status: 'ACTIVE' }] }));
  }) as unknown as typeof fetch;
  assert.deepEqual(await listVerifiedDomains(ORG, ENV, fetchImpl), ['example.com']);
  assert.equal(seen!.url, `http://domain-service:6012/api/org-setup/domains?entityId=${ORG}&status=ACTIVE`);
  assert.equal(seen!.key, 'k');
});

test('a check that cannot run is an error, never an allow', async () => {
  await assert.rejects(listVerifiedDomains(ORG, {}, answer(200, { items: [] })), DomainCheckUnavailableError);
  await assert.rejects(listVerifiedDomains(ORG, ENV, answer(401, {})), /answered 401/);
  await assert.rejects(listVerifiedDomains(ORG, ENV, answer(200, { rows: [] })), /unexpected body/);
  await assert.rejects(listVerifiedDomains(ORG, ENV, (async () => { throw new Error('connect ECONNREFUSED'); }) as unknown as typeof fetch), /not reachable/);
});

test('a host must be a verified domain exactly', () => {
  assert.equal(isVerifiedDomain('example.com', ['example.com']), true);
  assert.equal(isVerifiedDomain('EXAMPLE.com', ['example.com']), true);
  assert.equal(isVerifiedDomain('www.example.com', ['example.com']), false);
  assert.equal(isVerifiedDomain('example.com', []), false);
});
