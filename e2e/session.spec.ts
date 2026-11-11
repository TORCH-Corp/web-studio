/**
 * Session 2 "done when": the session comes from the Business OS access token,
 * and every route enforces the leaves.
 *
 * A token signed with the test key (the stand-in for auth-service's) goes
 * through the callback and yields the cookie, then the builder's API answers;
 * an expired cookie yields 401 and the builder, framed by a page that stands in
 * for the shell, posts torch:request-token and continues with the token it is
 * given; a Member (manage_content c r u, manage_sites r) gets 403 creating a
 * site; a person with no webstudio leaf gets no cookie and no data; a Viewer
 * gets 403 on every write. The permissions come from e2e/auth-stub.ts, which
 * answers for the people in e2e/auth-fixtures.ts.
 */

import { expect, request, test, type APIRequestContext, type APIResponse } from '@playwright/test';
import { generateKeyPairSync } from 'node:crypto';
import { signSession } from '@/lib/platform/session';
import { ORG, PEOPLE, claimsFor, type TestPerson } from './auth-fixtures';
import { callback, cookieNamed, createSite, signIn, signInWithToken, type SiteRecord } from './helpers';
import { signTestToken } from './test-keys';

test.describe.configure({ mode: 'serial' });

const RUN = Date.now().toString(36);
const tokenFor = (person: TestPerson, options?: Parameters<typeof signTestToken>[1]) => signTestToken(claimsFor(person), options);
const setCookies = (response: APIResponse) => response.headersArray().filter((h) => h.name.toLowerCase() === 'set-cookie').map((h) => h.value);

let baseURL: string;
let owner: APIRequestContext;
let site: SiteRecord;
let homepageId: string;

test.beforeAll(async ({ baseURL: configured }) => {
  baseURL = configured!;
});

test.afterAll(async () => {
  await owner?.dispose();
});

test('the shell\'s access token through the callback yields the session cookie, and the builder\'s API answers', async () => {
  const anonymous = await request.newContext({ baseURL });
  const entered = await callback(anonymous, tokenFor(PEOPLE.owner));
  expect(entered.status(), await entered.text()).toBe(303);
  expect(entered.headers()['location']).toBe('/ycode');
  owner = anonymous;

  const sessionCookie = await cookieNamed(owner, 'bos_session');
  expect(sessionCookie?.httpOnly).toBe(true);
  expect(await cookieNamed(owner, 'ws_site')).toBeUndefined();

  const before = Math.floor(Date.now() / 1000);
  const session = (await (await owner.get('/ycode/api/auth/session')).json()).data;
  expect(session.user.email).toBe(PEOPLE.owner.email);
  expect(session.user.user_metadata.name).toBe('Owner Person'); // from GET /users/me: the token has no name
  expect(session.organization).toBe(ORG);
  expect(session.site).toBeNull();
  expect(session.role).toBe('owner');
  expect(session.permissions['webstudio.manage_sites']).toEqual(expect.arrayContaining(['c', 'r', 'u', 'd', 'x', 'export', 'use_ai']));
  expect(Object.keys(session.permissions).every((leaf) => leaf.startsWith('webstudio.'))).toBe(true); // sales.manage_leads stays out
  expect(session.expiresAt).toBeGreaterThan(before + 800); // the cookie lives as long as the token (900 s)
  expect(session.expiresAt).toBeLessThanOrEqual(before + 901);

  site = await createSite(owner, { name: 'Session Site', slug: `s2-${RUN}`, languages: ['en'], default_language: 'en' });

  // The shell opens a site: token and site through the callback, which sets ws_site after the organization check.
  const opened = await callback(owner, tokenFor(PEOPLE.owner), site.id);
  expect(opened.status(), await opened.text()).toBe(303);
  expect((await cookieNamed(owner, 'ws_site'))?.httpOnly).toBe(true);

  const pages = await owner.get('/ycode/api/pages');
  expect(pages.status(), await pages.text()).toBe(200);
  const rows = (await pages.json()).data as Array<{ id: string; name: string }>;
  expect(rows.map((page) => page.name)).toContain('Homepage');
  homepageId = rows.find((page) => page.name === 'Homepage')!.id;

  expect((await (await owner.get('/ycode/api/auth/session')).json()).data.site.id).toBe(site.id);
});

test('a renewal asks for JSON and gets the session back, keeping the site the builder is on', async () => {
  const renewed = await callback(owner, tokenFor(PEOPLE.owner), undefined, { Accept: 'application/json' });
  expect(renewed.status(), await renewed.text()).toBe(200);
  const view = (await renewed.json()).data;
  expect(view.user.email).toBe(PEOPLE.owner.email);
  expect(view.site.id).toBe(site.id);
  expect(setCookies(renewed).some((c) => c.startsWith('bos_session=') && /HttpOnly/i.test(c))).toBe(true);
  // This suite reaches the server over plain HTTP: a Secure cookie would never come back.
  expect(setCookies(renewed).some((c) => /;\s*Secure/i.test(c))).toBe(false);
  expect(setCookies(renewed).some((c) => c.startsWith('ws_site='))).toBe(true);
});

test('a token that is forged, expired, from another key, without an organization, or missing is refused with no cookie', async () => {
  const anonymous = await request.newContext({ baseURL });
  try {
    const other = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
    const refusals: Array<[APIResponse, number]> = [
      [await callback(anonymous, tokenFor(PEOPLE.owner, { privateKeyPem: other })), 401],
      [await callback(anonymous, tokenFor(PEOPLE.owner, { ttlSeconds: -10 })), 401],
      [await callback(anonymous, `${tokenFor(PEOPLE.owner)}x`), 401],
      [await callback(anonymous, signTestToken({ ...claimsFor(PEOPLE.owner), entityId: undefined })), 403],
      [await anonymous.get('/ycode/api/auth/callback', { maxRedirects: 0 }), 400],
    ];
    for (const [response, status] of refusals) {
      expect(response.status(), await response.text()).toBe(status);
      expect(setCookies(response)).toEqual([]);
    }
    expect(await cookieNamed(anonymous, 'bos_session')).toBeUndefined();
    expect((await anonymous.get('/ycode/api/pages')).status()).toBe(401);
  } finally {
    await anonymous.dispose();
  }
});

test('a person with no webstudio leaf gets no cookie from the callback and no data from any route', async () => {
  const anonymous = await request.newContext({ baseURL });
  try {
    const refused = await callback(anonymous, tokenFor(PEOPLE.nobody));
    expect(refused.status()).toBe(403);
    expect((await refused.json()).error).toMatch(/No Web Studio permission/);
    expect(setCookies(refused)).toEqual([]);
  } finally {
    await anonymous.dispose();
  }

  // Even a session with the webstudio leaves all false gets nothing: the flag is checked on every route.
  const empty = await signIn(baseURL, { sub: PEOPLE.nobody.sub, email: PEOPLE.nobody.email, org: ORG, perms: {} } as never);
  try {
    for (const [method, path] of [['get', '/ycode/api/platform/sites'], ['get', '/ycode/api/pages'], ['get', '/ycode/api/editor/init'], ['post', '/ycode/api/pages'], ['post', '/ycode/api/platform/sites']] as const) {
      const response = method === 'get' ? await empty.get(path) : await empty.post(path, { data: {} });
      expect(response.status(), `${method.toUpperCase()} ${path}`).toBe(403);
      const body = await response.json();
      expect(body.data, `${method.toUpperCase()} ${path}`).toBeUndefined();
      expect(body.required).toMatch(/^webstudio\.manage_(sites|content)\.[a-z_]+$/);
    }
  } finally {
    await empty.dispose();
  }
});

test('an expired session cookie yields 401', async () => {
  process.env.BOS_SESSION_SECRET = 'e2e-session-secret'; // the app's, see playwright.config.ts
  const expired = await signSession({ sub: PEOPLE.owner.sub, email: PEOPLE.owner.email, name: 'Owner Person', org: ORG, perms: { 'webstudio.manage_content': ['r'] } }, -1);
  const stale = await request.newContext({ baseURL, storageState: { cookies: [{ name: 'bos_session', value: expired, domain: '127.0.0.1', path: '/', expires: -1, httpOnly: true, secure: false, sameSite: 'Lax' }], origins: [] } });
  try {
    expect((await stale.get('/ycode/api/pages')).status()).toBe(401);
    expect((await stale.get('/ycode/api/platform/sites')).status()).toBe(401);
    expect((await (await stale.get('/ycode/api/auth/session')).json()).data.user).toBeNull();
  } finally {
    await stale.dispose();
  }
});

test('when its session is gone, the builder asks its parent for a token and continues with the one it is given', async ({ page, context }) => {
  process.env.BOS_SESSION_SECRET = 'e2e-session-secret';
  const expired = await signSession({ sub: PEOPLE.owner.sub, email: PEOPLE.owner.email, name: 'Owner Person', org: ORG, perms: { 'webstudio.manage_content': ['r'] } }, -1);
  await context.addCookies([{ name: 'bos_session', value: expired, url: baseURL, httpOnly: true }]);

  // The harness stands in for the Tauri app (session 9): it frames the builder on the same origin,
  // collects what the builder posts to it, and answers with a token when the test says so.
  const harness = `<!doctype html><html><body>
    <script>window.__messages = []; window.addEventListener('message', (event) => { window.__messages.push(event.data); });</script>
    <iframe id="builder" src="/ycode" style="width:1200px;height:800px"></iframe>
  </body></html>`;
  await page.route(`${baseURL}/e2e-harness`, (route) => route.fulfill({ contentType: 'text/html', body: harness }));
  await page.goto(`${baseURL}/e2e-harness`);

  await page.waitForFunction(() => (window as unknown as { __messages: Array<{ type?: string }> }).__messages.some((m) => m?.type === 'torch:request-token'));
  const frame = page.frames().find((f) => f.url().includes('/ycode'))!;
  expect(frame).toBeTruthy();
  await expect(frame.locator('input[type="password"]')).toHaveCount(0); // never a login form
  expect((await context.cookies(baseURL)).find((c) => c.name === 'bos_session')?.value).toBe(expired); // nothing minted yet

  const token = tokenFor(PEOPLE.owner);
  await page.evaluate(
    ({ token, site }) => (document.getElementById('builder') as HTMLIFrameElement).contentWindow!.postMessage({ type: 'torch:set-token', token, site }, '*'),
    { token, site: site.id },
  );

  await expect.poll(async () => (await context.cookies(baseURL)).find((c) => c.name === 'bos_session')?.value, { timeout: 30_000 }).not.toBe(expired);
  await expect.poll(async () => frame.evaluate(async () => {
    const response = await fetch('/ycode/api/auth/session', { cache: 'no-store' });
    const body = (await response.json()) as { data: { user: { email: string } | null; site: { id: string } | null } };
    return body.data.user ? `${body.data.user.email}@${body.data.site?.id ?? '-'}` : null;
  }), { timeout: 30_000 }).toBe(`${PEOPLE.owner.email}@${site.id}`);
  await expect(frame.locator('input[type="password"]')).toHaveCount(0);
});

test('a Member edits content but may not create or delete sites', async () => {
  const member = await signInWithToken(baseURL, tokenFor(PEOPLE.member), site.id);
  try {
    expect((await (await member.get('/ycode/api/auth/session')).json()).data.user.user_metadata.name).toBe('Member Person'); // first and last name

    const create = await member.post('/ycode/api/platform/sites', { data: { name: 'Nope', slug: `nope-${RUN}`, languages: ['en'], default_language: 'en' } });
    expect(create.status()).toBe(403);
    expect((await create.json()).required).toBe('webstudio.manage_sites.c');

    const remove = await member.delete(`/ycode/api/platform/sites/${site.id}`);
    expect(remove.status()).toBe(403);
    expect((await remove.json()).required).toBe('webstudio.manage_sites.d');

    expect((await member.get('/ycode/api/platform/sites')).status()).toBe(200);
    // The owner has had the site open since the renewal test and so holds its editor lock (session 6): a
    // Member's write waits until the owner closes the site. lock.spec.ts covers the refusal itself.
    expect((await owner.delete('/ycode/api/platform/site-lock')).status()).toBe(200);
    const page = await member.post('/ycode/api/pages', { data: { name: 'By a member', slug: `member-${RUN}` } });
    expect(page.status(), await page.text()).toBe(200);
    const exported = await member.post('/ycode/api/project/export', { data: {} });
    expect(exported.status()).toBe(403);
    expect((await exported.json()).required).toBe('webstudio.manage_content.export');
  } finally {
    await member.dispose();
  }
});

test('a Viewer reads everything and gets 403 on every write', async () => {
  const viewer = await signInWithToken(baseURL, tokenFor(PEOPLE.viewer), site.id);
  try {
    for (const path of ['/ycode/api/platform/sites', '/ycode/api/pages', '/ycode/api/editor/init', '/ycode/api/locales', `/ycode/api/pages/${homepageId}`]) {
      const read = await viewer.get(path);
      expect(read.status(), `GET ${path}: ${await read.text()}`).toBe(200);
    }

    const writes: Array<[string, string, unknown?]> = [
      ['post', '/ycode/api/pages', { name: 'Nope', slug: 'nope' }],
      ['put', `/ycode/api/pages/${homepageId}`, { name: 'Renamed' }],
      ['delete', `/ycode/api/pages/${homepageId}`],
      ['put', '/ycode/api/layers', { layers: [] }],
      ['post', '/ycode/api/publish', { publishAll: true }],
      ['post', '/ycode/api/revert', {}],
      ['post', '/ycode/api/assets', { filename: 'x.svg', content: '<svg/>', source: 'file-manager' }],
      ['post', '/ycode/api/locales', { code: 'ar', name: 'Arabic' }],
      ['post', '/ycode/api/translations', {}],
      ['put', '/ycode/api/settings/site_name', { value: 'x' }],
      ['post', '/ycode/api/project/export', {}],
      ['post', '/ycode/api/ai/chat', { messages: [] }],
      ['post', '/ycode/api/platform/sites', { name: 'Nope', slug: `viewer-${RUN}`, languages: ['en'], default_language: 'en' }],
      ['delete', `/ycode/api/platform/sites/${site.id}`],
      ['post', '/ycode/api/devtools/reset-db', {}],
    ];
    for (const [method, path, data] of writes) {
      const response = await viewer.fetch(path, { method: method.toUpperCase(), data });
      expect(response.status(), `${method.toUpperCase()} ${path}: ${await response.text()}`).toBe(403);
      expect((await response.json()).required).toMatch(/^webstudio\.manage_(sites|content)\.(c|u|d|x|export|use_ai)$/);
    }
  } finally {
    await viewer.dispose();
  }

  // Nothing was written.
  const pages = (await (await owner.get('/ycode/api/pages')).json()).data as Array<{ name: string }>;
  expect(pages.map((page) => page.name)).toContain('Homepage');
  expect(pages.map((page) => page.name)).not.toContain('Nope');
  expect((await owner.get('/ycode/api/platform/sites').then((r) => r.json())).data.map((s: SiteRecord) => s.id)).toContain(site.id);
});

test('part 3, W1: collections follow the content leaf, submissions the forms leaf, and the session carries the reports leaf', async () => {
  const permissionsOf = async (api: APIRequestContext) => (await (await api.get('/ycode/api/auth/session')).json()).data.permissions as Record<string, string[]>;
  const refusal = async (response: APIResponse) => {
    expect(response.status(), await response.text()).toBe(403);
    return (await response.json()).required as string;
  };
  const SUBMISSION = '5f1a4b0e-0000-4000-8000-000000000000';

  // The fifth leaf is read at sign-in like the others, and GET /auth/session returns its flags.
  expect((await permissionsOf(owner))['webstudio.manage_reports']).toEqual(['c', 'r', 'u', 'd', 'x', 'export', 'use_ai']);

  let collectionId: string;
  const member = await signInWithToken(baseURL, tokenFor(PEOPLE.member), site.id);
  try {
    const permissions = await permissionsOf(member);
    expect(permissions['webstudio.manage_reports']).toEqual(['r']);
    expect(permissions['webstudio.manage_forms']).toEqual(['r']);

    // A Member creates a collection (content c) and may not delete it (content d).
    const created = await member.post('/ycode/api/collections', { data: { name: `Posts ${RUN}` } });
    expect(created.ok(), await created.text()).toBe(true);
    collectionId = (await created.json()).data.id;
    expect(await refusal(await member.delete(`/ycode/api/collections/${collectionId}`))).toBe('webstudio.manage_content.d');
    // Submissions: a Member reads them (forms r) and may not change or delete one.
    expect((await member.get('/ycode/api/form-submissions')).status()).toBe(200);
    expect(await refusal(await member.put(`/ycode/api/form-submissions/${SUBMISSION}`, { data: { status: 'read' } }))).toBe('webstudio.manage_forms.u');
    expect(await refusal(await member.delete(`/ycode/api/form-submissions/${SUBMISSION}`))).toBe('webstudio.manage_forms.d');
    // The Member's write took the site's editor lock: let go, so the owner can clean up below.
    expect((await member.delete('/ycode/api/platform/site-lock')).status()).toBe(200);
  } finally {
    await member.dispose();
  }

  const viewer = await signInWithToken(baseURL, tokenFor(PEOPLE.viewer), site.id);
  try {
    expect((await permissionsOf(viewer))['webstudio.manage_reports']).toEqual(['r']);
    // A Viewer reads collections and submissions, and changes neither.
    const list = await viewer.get('/ycode/api/collections');
    expect(list.status(), await list.text()).toBe(200);
    expect(((await list.json()).data as Array<{ id: string }>).map((collection) => collection.id)).toContain(collectionId);
    expect((await viewer.get('/ycode/api/form-submissions')).status()).toBe(200);
    expect(await refusal(await viewer.post('/ycode/api/collections', { data: { name: 'Nope' } }))).toBe('webstudio.manage_content.c');
    expect(await refusal(await viewer.put(`/ycode/api/collections/${collectionId}`, { data: { name: 'Renamed' } }))).toBe('webstudio.manage_content.u');
    expect(await refusal(await viewer.post(`/ycode/api/collections/${collectionId}/publish`, { data: {} }))).toBe('webstudio.manage_content.u');
    expect(await refusal(await viewer.put(`/ycode/api/form-submissions/${SUBMISSION}`, { data: { status: 'read' } }))).toBe('webstudio.manage_forms.u');
    // The r that reads submissions reads no webhook (its signing secret), API key or integration: since part 3, session W2
    // those routes are not found for anyone, so the answer is the same 404 as for the Manager (offline.spec.ts).
    for (const path of ['webhooks', 'api-keys', 'apps/airtable/connections']) {
      expect((await viewer.get(`/ycode/api/${path}`)).status(), path).toBe(404);
      expect((await viewer.head(`/ycode/api/${path}`)).status(), `HEAD ${path}`).toBe(404);
    }
  } finally {
    await viewer.dispose();
  }

  // Every flag on the forms leaf and nothing else: collections are out of reach since they moved to content.
  const formsOnly = await signIn(baseURL, { sub: PEOPLE.nobody.sub, email: PEOPLE.nobody.email, org: ORG, perms: { 'webstudio.manage_forms': ['c', 'r', 'u', 'd', 'x', 'export', 'use_ai'] } } as never);
  try {
    expect(await refusal(await formsOnly.get('/ycode/api/collections'))).toBe('webstudio.manage_content.r');
    expect(await refusal(await formsOnly.get(`/ycode/api/collections/${collectionId}/items`))).toBe('webstudio.manage_content.r');
    expect(await refusal(await formsOnly.post('/ycode/api/collections', { data: { name: 'Nope' } }))).toBe('webstudio.manage_content.c');
  } finally {
    await formsOnly.dispose();
  }

  // A Manager does not read the hidden set-up either (part 3, session W2: hidden whatever the flags).
  expect((await owner.get('/ycode/api/webhooks')).status()).toBe(404);

  // The Viewer and the forms-only user changed nothing; the owner (content d) removes the Member's collection.
  const collections = (await (await owner.get('/ycode/api/collections')).json()).data as Array<{ id: string; name: string }>;
  expect(collections.filter((collection) => collection.name === 'Nope' || collection.name === 'Renamed')).toEqual([]);
  expect(collections.find((collection) => collection.id === collectionId)?.name).toBe(`Posts ${RUN}`);
  const removed = await owner.delete(`/ycode/api/collections/${collectionId}`);
  expect(removed.ok(), await removed.text()).toBe(true);
});
