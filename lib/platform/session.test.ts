import assert from 'node:assert/strict';
import { test } from 'node:test';

import { cookieAttributes, hasSalesOrdersExecute, signSession, signSiteCookie, verifySession, verifySiteCookie } from './session';

process.env.BOS_SESSION_SECRET = 'unit-test-secret';

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';
const SITE = '33333333-3333-4333-8333-333333333333';

test('a site cookie round-trips with its site and organization', async () => {
  const token = await signSiteCookie({ site: SITE, org: ORG_A });
  const body = await verifySiteCookie(token);
  assert.equal(body?.site, SITE);
  assert.equal(body?.org, ORG_A);
  assert.ok(body && body.exp > body.iat);
});

test('a tampered site cookie is refused', async () => {
  const token = await signSiteCookie({ site: SITE, org: ORG_A });
  const [head, , sig] = token.split('.');
  const forgedBody = Buffer.from(JSON.stringify({ site: SITE, org: ORG_B, iat: 1, exp: 4102444800 })).toString('base64url');
  assert.equal(await verifySiteCookie(`${head}.${forgedBody}.${sig}`), null);
  assert.equal(await verifySiteCookie(token.slice(0, -2)), null);
  assert.equal(await verifySiteCookie('not-a-token'), null);
  assert.equal(await verifySiteCookie(undefined), null);
});

test('an expired site cookie is refused', async () => {
  const token = await signSiteCookie({ site: SITE, org: ORG_A }, -1);
  assert.equal(await verifySiteCookie(token), null);
});

test('a session token is not a site cookie, and a site cookie is not a session', async () => {
  const session = await signSession({ sub: 'u1', email: 'u1@example.com', name: 'U1', org: ORG_A, perms: {} });
  const siteCookie = await signSiteCookie({ site: SITE, org: ORG_A });
  assert.equal(await verifySiteCookie(session), null);
  assert.equal(await verifySession(siteCookie), null);
  assert.equal((await verifySession(session))?.org, ORG_A);
});

test('cookie attributes: Secure follows the scheme nginx reports, else the request URL', () => {
  const nginx = new Headers({ 'x-forwarded-proto': 'https' });
  const plainProxy = new Headers({ 'x-forwarded-proto': 'http' });
  const direct = new Headers();
  assert.equal(cookieAttributes(nginx, new URL('http://127.0.0.1:6030/ycode/api/auth/callback')).secure, true);
  assert.equal(cookieAttributes(plainProxy, new URL('https://web-studio.torchcorp.com/ycode')).secure, false);
  assert.equal(cookieAttributes(direct, new URL('https://web-studio.torchcorp.com/ycode')).secure, true);
  assert.deepEqual(cookieAttributes(direct, new URL('http://127.0.0.1:3102/ycode')), { path: '/', httpOnly: true, sameSite: 'lax', secure: false });
});

test('cookie attributes: a chain of proxies is judged by the first scheme', () => {
  assert.equal(cookieAttributes(new Headers({ 'x-forwarded-proto': 'https, http' }), new URL('http://127.0.0.1:6030/')).secure, true);
});

test('the session keeps the user\'s Sales flag; a cookie from before it was added has none', async () => {
  const base = { sub: 'u1', email: 'u1@example.com', name: 'U1', org: ORG_A, perms: {} };
  const with_ = await verifySession(await signSession({ ...base, sales_manage_orders_x: true }));
  const without = await verifySession(await signSession({ ...base, sales_manage_orders_x: false }));
  const old = await verifySession(await signSession(base));
  assert.equal(with_?.sales_manage_orders_x, true);
  assert.equal(without?.sales_manage_orders_x, false);
  assert.equal(hasSalesOrdersExecute(with_), true);
  assert.equal(hasSalesOrdersExecute(without), false);
  assert.equal(hasSalesOrdersExecute(old), false);
  assert.equal(hasSalesOrdersExecute(null), false);
});
