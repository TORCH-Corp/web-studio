import assert from 'node:assert/strict';
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import { permissionsFromLeafMap } from './auth-service';
import { API_ROUTE_ACCESS, accessFor, flagForMethod, isEditingWrite, matchApiRoute, requirementName, mayHoldSiteLock } from './permissions';
import { hasFlag, type BosSession } from './session';
import { WEB_STUDIO_LEAF, buildWebStudioScope, scopeLeaves } from './web-studio-scope';

const API_DIR = path.join(__dirname, '..', '..', 'app', '(builder)', 'ycode', 'api');

/** Every route file under app/(builder)/ycode/api, as its path pattern under /ycode/api. */
function routePatterns(dir = API_DIR, prefix = ''): string[] {
  const patterns: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      patterns.push(...routePatterns(full, prefix ? `${prefix}/${entry}` : entry));
    } else if (entry === 'route.ts') {
      patterns.push(prefix);
    }
  }
  return patterns;
}

const q = (s = '') => new URLSearchParams(s);

test('every route file under /ycode/api is in the map, and every map entry has a route file', () => {
  const files = routePatterns().sort();
  assert.ok(files.length > 100, `expected ycode's routes, found ${files.length}`);
  const unmapped = files.filter((pattern) => !API_ROUTE_ACCESS[pattern]);
  assert.deepEqual(unmapped, [], `route files with no permission rule: ${unmapped.join(', ')}`);
  const stale = Object.keys(API_ROUTE_ACCESS).filter((pattern) => !files.includes(pattern));
  assert.deepEqual(stale, [], `permission rules with no route file: ${stale.join(', ')}`);
});

test('the flag follows the method unless the route says otherwise', () => {
  assert.equal(flagForMethod('POST'), 'c');
  assert.equal(flagForMethod('GET'), 'r');
  assert.equal(flagForMethod('PUT'), 'u');
  assert.equal(flagForMethod('PATCH'), 'u');
  assert.equal(flagForMethod('DELETE'), 'd');
  assert.equal(flagForMethod('HEAD'), 'r');

  assert.deepEqual(accessFor('/ycode/api/platform/sites', 'GET', q()), { kind: 'leaf', leaf: 'webstudio.manage_sites', flag: 'r' });
  assert.deepEqual(accessFor('/ycode/api/platform/sites', 'POST', q()), { kind: 'leaf', leaf: 'webstudio.manage_sites', flag: 'c' });
  assert.deepEqual(accessFor('/ycode/api/platform/sites/3f0b2c7e-2d7a-4c3e-9a1e-7b1d2e3f4a5b', 'DELETE', q()), { kind: 'leaf', leaf: 'webstudio.manage_sites', flag: 'd' });
  assert.deepEqual(accessFor('/ycode/api/platform/sites/3f0b2c7e-2d7a-4c3e-9a1e-7b1d2e3f4a5b', 'PATCH', q()), { kind: 'leaf', leaf: 'webstudio.manage_sites', flag: 'u' });
  assert.deepEqual(accessFor('/ycode/api/platform/sites/3f0b2c7e-2d7a-4c3e-9a1e-7b1d2e3f4a5b/open', 'GET', q()), { kind: 'leaf', leaf: 'webstudio.manage_sites', flag: 'r' });
  assert.deepEqual(accessFor('/ycode/api/platform/templates', 'GET', q()), { kind: 'leaf', leaf: 'webstudio.manage_sites', flag: 'r' });
  // Store settings (part 2, W1): seen with r, changed with u, like the site settings.
  assert.deepEqual(accessFor('/ycode/api/platform/sites/3f0b2c7e-2d7a-4c3e-9a1e-7b1d2e3f4a5b/store', 'GET', q()), { kind: 'leaf', leaf: 'webstudio.manage_sites', flag: 'r' });
  assert.deepEqual(accessFor('/ycode/api/platform/sites/3f0b2c7e-2d7a-4c3e-9a1e-7b1d2e3f4a5b/store', 'PATCH', q()), { kind: 'leaf', leaf: 'webstudio.manage_sites', flag: 'u' });
  assert.deepEqual(accessFor('/ycode/api/pages', 'POST', q()), { kind: 'leaf', leaf: 'webstudio.manage_content', flag: 'c' });
  assert.deepEqual(accessFor('/ycode/api/pages/abc/status', 'POST', q()), { kind: 'leaf', leaf: 'webstudio.manage_content', flag: 'u' });
  assert.deepEqual(accessFor('/ycode/api/publish', 'POST', q()), { kind: 'leaf', leaf: 'webstudio.manage_content', flag: 'u' });
  assert.deepEqual(accessFor('/ycode/api/project/export', 'POST', q()), { kind: 'leaf', leaf: 'webstudio.manage_content', flag: 'export' });
  assert.deepEqual(accessFor('/ycode/api/apps/static-export/export', 'POST', q()), { kind: 'leaf', leaf: 'webstudio.manage_content', flag: 'export' });
  assert.deepEqual(accessFor('/ycode/api/ai/chat', 'POST', q()), { kind: 'leaf', leaf: 'webstudio.manage_content', flag: 'use_ai' });
  assert.deepEqual(accessFor('/ycode/api/collections/items/delete', 'POST', q()), { kind: 'leaf', leaf: 'webstudio.manage_content', flag: 'd' });
  assert.deepEqual(accessFor('/ycode/api/devtools/reset-db', 'POST', q()), { kind: 'leaf', leaf: 'webstudio.manage_sites', flag: 'd' });
});

test('the most literal pattern wins over a dynamic segment', () => {
  assert.equal(matchApiRoute('/ycode/api/collections/c1/items/filter'), 'collections/[id]/items/filter');
  assert.equal(matchApiRoute('/ycode/api/collections/c1/items/i1'), 'collections/[id]/items/[item_id]');
  assert.equal(matchApiRoute('/ycode/api/pages/slug/about'), 'pages/slug/[slug]');
  assert.equal(matchApiRoute('/ycode/api/pages/p1/duplicate'), 'pages/[id]/duplicate');
  assert.equal(matchApiRoute('/ycode/api/collections/import/process'), 'collections/import/process');
  assert.equal(matchApiRoute('/ycode/api/collections/c1/fields'), 'collections/[id]/fields');
  assert.equal(matchApiRoute('/ycode/api/platform/sites/'), 'platform/sites');
  assert.equal(matchApiRoute('/ycode/api/fonts/mirror/s/roboto/v30/file.woff2'), 'fonts/mirror/s/[...path]');
  assert.equal(matchApiRoute('/ycode/api/fonts/mirror/s/file.woff2'), 'fonts/mirror/s/[...path]');
  assert.equal(matchApiRoute('/ycode/api/fonts/mirror/s'), null);
  assert.equal(matchApiRoute('/ycode/api/fonts/mirror/css2'), 'fonts/mirror/css2');
  assert.equal(matchApiRoute('/ycode/api/pages//status'), null);
  assert.equal(matchApiRoute('/ycode/api/nothing/here'), null);
  assert.equal(matchApiRoute('/ycode/other'), null);
});

test('public and session-only routes, and the anonymous exceptions for visitors', () => {
  assert.deepEqual(accessFor('/ycode/api/auth/callback', 'GET', q('token=x')), { kind: 'public' });
  assert.deepEqual(accessFor('/ycode/api/auth/session', 'GET', q()), { kind: 'public' });
  assert.deepEqual(accessFor('/ycode/api/setup/status', 'GET', q()), { kind: 'public' });
  assert.deepEqual(accessFor('/ycode/api/health', 'GET', q()), { kind: 'public' });
  assert.deepEqual(accessFor('/ycode/api/v1/forms/f1/submissions', 'POST', q()), { kind: 'public' });
  assert.deepEqual(accessFor('/ycode/api/oauth/authorize', 'POST', q()), { kind: 'session' });
  assert.deepEqual(accessFor('/ycode/api/icons', 'GET', q('search=home')), { kind: 'leaf', leaf: 'webstudio.manage_content', flag: 'r' });

  assert.deepEqual(accessFor('/ycode/api/form-submissions', 'POST', q()), { kind: 'public' });
  assert.deepEqual(accessFor('/ycode/api/form-submissions', 'GET', q()), { kind: 'leaf', leaf: 'webstudio.manage_forms', flag: 'r' });
  assert.deepEqual(accessFor('/ycode/api/error-page', 'GET', q('code=404&published=true')), { kind: 'public' });
  assert.deepEqual(accessFor('/ycode/api/error-page', 'GET', q('code=404')), { kind: 'leaf', leaf: 'webstudio.manage_content', flag: 'r' });
  assert.deepEqual(accessFor('/ycode/api/collections/c1/items/filter', 'POST', q()), { kind: 'public' });
  // The storefront's reads (part 2, W2): anonymous on GET; any other method is the storefront leaf's, which no route serves.
  for (const path of ['store/products', 'store/products/3f0b2c7e-2d7a-4c3e-9a1e-7b1d2e3f4a5b', 'store/categories', 'store/settings']) {
    assert.deepEqual(accessFor(`/ycode/api/${path}`, 'GET', q('page=2')), { kind: 'public' }, path);
    assert.deepEqual(accessFor(`/ycode/api/${path}`, 'POST', q()), { kind: 'leaf', leaf: 'webstudio.manage_orders', flag: 'c' }, path);
  }
  // The checkout (W3): anonymous on POST only; its confirmation read on GET only.
  assert.deepEqual(accessFor('/ycode/api/store/checkout', 'POST', q()), { kind: 'public' });
  assert.deepEqual(accessFor('/ycode/api/store/checkout', 'GET', q()), { kind: 'leaf', leaf: 'webstudio.manage_orders', flag: 'r' });
  assert.deepEqual(accessFor('/ycode/api/store/orders/3f0b2c7e-2d7a-4c3e-9a1e-7b1d2e3f4a5b', 'GET', q()), { kind: 'public' });
  assert.deepEqual(accessFor('/ycode/api/store/orders/3f0b2c7e-2d7a-4c3e-9a1e-7b1d2e3f4a5b', 'DELETE', q()), { kind: 'leaf', leaf: 'webstudio.manage_orders', flag: 'd' });
  // A published page's view (part 3, W7): anonymous; the route itself answers on a site's own host only.
  assert.deepEqual(accessFor('/ycode/api/visits', 'POST', q()), { kind: 'public' });
  assert.deepEqual(accessFor('/ycode/api/collections/c1/items/load-more', 'POST', q()), { kind: 'public' });
  assert.deepEqual(accessFor('/ycode/api/collections/c1/items/i1', 'POST', q()), { kind: 'leaf', leaf: 'webstudio.manage_content', flag: 'c' });
});

test('the Orders API (part 2, W8): r to list and read, x to confirm and cancel, on the orders leaf', () => {
  const ORDER = '3f0b2c7e-2d7a-4c3e-9a1e-7b1d2e3f4a5b';
  const leaf = (flag: string) => ({ kind: 'leaf', leaf: 'webstudio.manage_orders', flag });
  assert.deepEqual(accessFor('/ycode/api/platform/orders', 'GET', q('site_id=x&status=draft')), leaf('r'));
  assert.deepEqual(accessFor('/ycode/api/platform/orders/waiting-count', 'GET', q()), leaf('r'));
  assert.deepEqual(accessFor(`/ycode/api/platform/orders/${ORDER}`, 'GET', q()), leaf('r'));
  assert.deepEqual(accessFor(`/ycode/api/platform/orders/${ORDER}/confirm`, 'POST', q()), leaf('x'));
  assert.deepEqual(accessFor(`/ycode/api/platform/orders/${ORDER}/cancel`, 'POST', q()), leaf('x'));
  // The waiting count is its own route, not an order called "waiting-count".
  assert.equal(matchApiRoute('/ycode/api/platform/orders/waiting-count'), 'platform/orders/waiting-count');
  assert.equal(matchApiRoute(`/ycode/api/platform/orders/${ORDER}`), 'platform/orders/[id]');
  // Nothing else is served: an order cannot be edited or deleted here, and the other statuses are Sales's.
  assert.equal(matchApiRoute(`/ycode/api/platform/orders/${ORDER}/deliver`), null);
  // Orders are not the open site's content: no editor lock.
  assert.equal(isEditingWrite(accessFor(`/ycode/api/platform/orders/${ORDER}/confirm`, 'POST', q())!, 'POST'), false);
});

/** A session with the flags a profile holds, read the way the callback reads them at sign-in. */
function sessionWith(leafMap: Record<string, Record<string, boolean>>): BosSession {
  return { sub: 'u', email: 'u@example.com', name: 'U', org: 'o', perms: permissionsFromLeafMap(leafMap), iat: 0, exp: 0 };
}

/** The session of a new organization's Manager, Member or Viewer: the defaults the published scope carries. */
function sessionOfProfile(profile: 'manager' | 'member' | 'viewer'): BosSession {
  const leaves = scopeLeaves(buildWebStudioScope('de4944b6-b43a-4cc5-96fe-c1d38852b61d'));
  return sessionWith(Object.fromEntries(leaves.map((leaf) => [leaf.leaf_key, leaf.system_role_defaults[profile]])));
}

/** What the proxy decides: public and session-only requests pass, a leaf request needs its flag. */
function allowed(session: BosSession, method: string, pathname: string): boolean {
  const decision = accessFor(pathname, method, q());
  assert.ok(decision && decision.kind !== 'unmapped', `${method} ${pathname} is mapped`);
  return decision.kind !== 'leaf' || hasFlag(session, decision.leaf, decision.flag);
}

test('part 3, W1: every collections route is on the content leaf, with the flag its verb needs', () => {
  const C = '/ycode/api/collections';
  const content = (flag: string) => ({ kind: 'leaf', leaf: 'webstudio.manage_content', flag });
  const expected: Array<[string, string, string]> = [
    // Read.
    ['GET', C, 'r'],
    ['GET', `${C}/c1`, 'r'],
    ['GET', `${C}/c1/usage`, 'r'],
    ['GET', `${C}/c1/fields`, 'r'],
    ['GET', `${C}/c1/fields/f1`, 'r'],
    ['GET', `${C}/c1/fields/f1/usage`, 'r'],
    ['GET', `${C}/fields`, 'r'],
    ['GET', `${C}/c1/items`, 'r'],
    ['GET', `${C}/c1/items/i1`, 'r'],
    ['GET', `${C}/c1/items/i1/values`, 'r'],
    ['GET', `${C}/c1/items/published`, 'r'],
    ['GET', `${C}/c1/items/unpublished`, 'r'],
    ['GET', `${C}/import/imp1/status`, 'r'],
    ['POST', `${C}/items/batch`, 'r'],
    ['POST', `${C}/items/slugs`, 'r'],
    // Create.
    ['POST', C, 'c'],
    ['POST', `${C}/sample`, 'c'],
    ['POST', `${C}/c1/fields`, 'c'],
    ['POST', `${C}/c1/items`, 'c'],
    ['POST', `${C}/c1/items/i1/duplicate`, 'c'],
    ['POST', `${C}/c1/import`, 'c'],
    ['POST', `${C}/import/process`, 'c'],
    // Change.
    ['PUT', `${C}/c1`, 'u'],
    ['PUT', `${C}/reorder`, 'u'],
    ['PUT', `${C}/c1/fields/f1`, 'u'],
    ['PUT', `${C}/c1/fields/reorder`, 'u'],
    ['PUT', `${C}/c1/items/i1`, 'u'],
    ['PUT', `${C}/c1/items/i1/status`, 'u'],
    ['PUT', `${C}/c1/items/i1/values`, 'u'],
    ['POST', `${C}/c1/items/reorder`, 'u'],
    // Publish.
    ['POST', `${C}/c1/publish`, 'u'],
    // Delete.
    ['DELETE', `${C}/c1`, 'd'],
    ['DELETE', `${C}/c1/fields/f1`, 'd'],
    ['DELETE', `${C}/c1/items/i1`, 'd'],
    ['POST', `${C}/items/delete`, 'd'],
  ];
  for (const [method, pathname, flag] of expected) assert.deepEqual(accessFor(pathname, method, q()), content(flag), `${method} ${pathname}`);

  // No collections route is left on another leaf: a session route (not the public API under v1/) is content's.
  for (const [pattern, rule] of Object.entries(API_ROUTE_ACCESS)) {
    if (!pattern.startsWith('collections')) continue;
    assert.equal(rule.kind === 'leaf' && rule.leaf, 'webstudio.manage_content', pattern);
  }
  // A published page's visitor still filters and pages a collection without a session.
  assert.deepEqual(accessFor(`${C}/c1/items/filter`, 'POST', q()), { kind: 'public' });
  assert.deepEqual(accessFor(`${C}/c1/items/load-more`, 'POST', q()), { kind: 'public' });
  // A collection write changes the open site, so it waits for the editor lock like a page write.
  assert.equal(isEditingWrite(accessFor(C, 'POST', q())!, 'POST'), true);
  assert.equal(isEditingWrite(accessFor(`${C}/c1/publish`, 'POST', q())!, 'POST'), true);
});

test('part 3, W6: the app\'s list of a site\'s collections is content r: a Viewer reads it, the forms and sites leaves do not', () => {
  const list = '/ycode/api/platform/sites/3f0b2c7e-2d7a-4c3e-9a1e-7b1d2e3f4a5b/collections';
  assert.equal(matchApiRoute(list), 'platform/sites/[id]/collections');
  assert.deepEqual(accessFor(list, 'GET', q()), { kind: 'leaf', leaf: 'webstudio.manage_content', flag: 'r' });
  // It is a read, never an editing write: no editor lock is asked for.
  assert.equal(isEditingWrite(accessFor(list, 'GET', q())!, 'GET'), false);
  // The write side stays the builder's: this route has no write verb the map would let through as anything but c, u or d on content.
  assert.deepEqual(accessFor(list, 'POST', q()), { kind: 'leaf', leaf: 'webstudio.manage_content', flag: 'c' });

  assert.equal(allowed(sessionOfProfile('viewer'), 'GET', list), true);
  assert.equal(allowed(sessionOfProfile('member'), 'GET', list), true);
  const every = { c: true, r: true, u: true, d: true, x: true, export: true, use_ai: true };
  assert.equal(allowed(sessionWith({ 'webstudio.manage_sites': every, 'webstudio.manage_forms': every }), 'GET', list), false);
});

test('part 3, W1: form submissions stay on the forms leaf: r to list and read, u for a status, d to delete, a visitor\'s POST anonymous', () => {
  const forms = (flag: string) => ({ kind: 'leaf', leaf: 'webstudio.manage_forms', flag });
  assert.deepEqual(accessFor('/ycode/api/form-submissions', 'GET', q('form_id=contact')), forms('r'));
  assert.deepEqual(accessFor('/ycode/api/form-submissions/s1', 'GET', q()), forms('r'));
  assert.deepEqual(accessFor('/ycode/api/form-submissions/s1', 'PUT', q()), forms('u'));
  assert.deepEqual(accessFor('/ycode/api/form-submissions/s1', 'DELETE', q()), forms('d'));
  assert.deepEqual(accessFor('/ycode/api/form-submissions', 'DELETE', q()), forms('d'));
  assert.deepEqual(accessFor('/ycode/api/form-submissions', 'POST', q()), { kind: 'public' });
  // Only the list route's POST is the visitor's: a POST on one submission is not anonymous.
  assert.deepEqual(accessFor('/ycode/api/form-submissions/s1', 'POST', q()), forms('c'));
});

test('part 3, W1: with the scope\'s defaults a Member creates and changes a collection and may not delete one', () => {
  const member = sessionOfProfile('member');
  assert.equal(allowed(member, 'GET', '/ycode/api/collections'), true);
  assert.equal(allowed(member, 'POST', '/ycode/api/collections'), true);
  assert.equal(allowed(member, 'POST', '/ycode/api/collections/c1/items'), true);
  assert.equal(allowed(member, 'PUT', '/ycode/api/collections/c1/items/i1'), true);
  assert.equal(allowed(member, 'POST', '/ycode/api/collections/c1/publish'), true);
  assert.equal(allowed(member, 'DELETE', '/ycode/api/collections/c1'), false);
  assert.equal(allowed(member, 'POST', '/ycode/api/collections/items/delete'), false);
  // Submissions: read, not changed or deleted.
  assert.equal(allowed(member, 'GET', '/ycode/api/form-submissions'), true);
  assert.equal(allowed(member, 'GET', '/ycode/api/form-submissions/s1'), true);
  assert.equal(allowed(member, 'PUT', '/ycode/api/form-submissions/s1'), false);
  assert.equal(allowed(member, 'DELETE', '/ycode/api/form-submissions/s1'), false);
});

test('part 3, W1: with the scope\'s defaults a Viewer reads collections and submissions and changes neither', () => {
  const viewer = sessionOfProfile('viewer');
  for (const pathname of ['/ycode/api/collections', '/ycode/api/collections/c1', '/ycode/api/collections/c1/items', '/ycode/api/collections/c1/items/i1', '/ycode/api/form-submissions', '/ycode/api/form-submissions/s1']) {
    assert.equal(allowed(viewer, 'GET', pathname), true, pathname);
  }
  assert.equal(allowed(viewer, 'POST', '/ycode/api/collections/items/batch'), true); // a read that uses POST
  const writes: Array<[string, string]> = [
    ['POST', '/ycode/api/collections'],
    ['PUT', '/ycode/api/collections/c1'],
    ['DELETE', '/ycode/api/collections/c1'],
    ['POST', '/ycode/api/collections/c1/publish'],
    ['POST', '/ycode/api/collections/c1/fields'],
    ['POST', '/ycode/api/collections/c1/items'],
    ['PUT', '/ycode/api/collections/c1/items/i1'],
    ['PUT', '/ycode/api/collections/c1/items/i1/status'],
    ['POST', '/ycode/api/collections/c1/items/reorder'],
    ['POST', '/ycode/api/collections/items/delete'],
    ['POST', '/ycode/api/collections/c1/import'],
    ['PUT', '/ycode/api/form-submissions/s1'],
    ['DELETE', '/ycode/api/form-submissions/s1'],
    ['DELETE', '/ycode/api/form-submissions'],
  ];
  for (const [method, pathname] of writes) assert.equal(allowed(viewer, method, pathname), false, `${method} ${pathname}`);
});

test('part 3, W1: the forms leaf alone no longer reaches collections, and the content leaf alone does not reach submissions', () => {
  const every = { c: true, r: true, u: true, d: true, x: true, export: true, use_ai: true };
  const formsOnly = sessionWith({ 'webstudio.manage_forms': every });
  for (const [method, pathname] of [['GET', '/ycode/api/collections'], ['GET', '/ycode/api/collections/c1/items'], ['POST', '/ycode/api/collections'], ['PUT', '/ycode/api/collections/c1'], ['DELETE', '/ycode/api/collections/c1'], ['POST', '/ycode/api/collections/items/batch']]) {
    assert.equal(allowed(formsOnly, method, pathname), false, `${method} ${pathname}`);
  }
  assert.equal(allowed(formsOnly, 'GET', '/ycode/api/form-submissions'), true);
  assert.equal(allowed(formsOnly, 'PUT', '/ycode/api/form-submissions/s1'), true);
  assert.equal(allowed(formsOnly, 'DELETE', '/ycode/api/form-submissions/s1'), true);

  const contentOnly = sessionWith({ 'webstudio.manage_content': every });
  assert.equal(allowed(contentOnly, 'DELETE', '/ycode/api/collections/c1'), true);
  assert.equal(allowed(contentOnly, 'GET', '/ycode/api/form-submissions'), false);
  assert.equal(allowed(contentOnly, 'DELETE', '/ycode/api/form-submissions/s1'), false);
});

test('part 3, W1: r on the forms leaf reads submissions only: webhooks, API keys and the integrations need x to read', () => {
  const hiddenReads = ['/ycode/api/webhooks', '/ycode/api/webhooks/w1', '/ycode/api/webhooks/w1/deliveries', '/ycode/api/api-keys', '/ycode/api/apps/airtable/connections', '/ycode/api/apps/airtable/bases', '/ycode/api/apps/webflow/imports', '/ycode/api/apps/webflow/sites', '/ycode/api/apps/mailerlite/groups'];
  for (const pathname of hiddenReads) {
    assert.deepEqual(accessFor(pathname, 'GET', q()), { kind: 'leaf', leaf: 'webstudio.manage_forms', flag: 'x' }, pathname);
    assert.deepEqual(accessFor(pathname, 'HEAD', q()), { kind: 'leaf', leaf: 'webstudio.manage_forms', flag: 'x' }, `HEAD ${pathname}`);
    assert.equal(allowed(sessionOfProfile('member'), 'GET', pathname), false, `member ${pathname}`);
    assert.equal(allowed(sessionOfProfile('viewer'), 'GET', pathname), false, `viewer ${pathname}`);
    assert.equal(allowed(sessionOfProfile('manager'), 'GET', pathname), true, `manager ${pathname}`);
  }
  // Every GET of the forms leaf that r opens is a submissions route.
  const openToReaders = Object.entries(API_ROUTE_ACCESS)
    .filter(([, rule]) => rule.kind === 'leaf' && rule.leaf === 'webstudio.manage_forms' && (rule.flags?.GET ?? 'r') === 'r')
    .map(([pattern]) => pattern)
    .sort();
  assert.deepEqual(openToReaders, ['form-submissions', 'form-submissions/[id]']);
  // Their writes keep the flags they had.
  assert.deepEqual(accessFor('/ycode/api/webhooks', 'POST', q()), { kind: 'leaf', leaf: 'webstudio.manage_forms', flag: 'c' });
  assert.deepEqual(accessFor('/ycode/api/webhooks/w1', 'POST', q()), { kind: 'leaf', leaf: 'webstudio.manage_forms', flag: 'u' });
  assert.deepEqual(accessFor('/ycode/api/api-keys/k1', 'DELETE', q()), { kind: 'leaf', leaf: 'webstudio.manage_forms', flag: 'd' });
  assert.deepEqual(accessFor('/ycode/api/apps/airtable/sync', 'POST', q()), { kind: 'leaf', leaf: 'webstudio.manage_forms', flag: 'u' });
});

test('part 3, W1 and W9: the reports leaf is a leaf of the session, and the three report routes are on it, for r', () => {
  assert.equal(WEB_STUDIO_LEAF.manageReports, 'webstudio.manage_reports');
  assert.equal(requirementName({ leaf: WEB_STUDIO_LEAF.manageReports, flag: 'r' }), 'webstudio.manage_reports.r');
  // Read at sign-in like the others, and held by the three default profiles: Manager every flag, Member and Viewer r.
  assert.deepEqual(sessionOfProfile('manager').perms['webstudio.manage_reports'], ['c', 'r', 'u', 'd', 'x', 'export', 'use_ai']);
  assert.deepEqual(sessionOfProfile('member').perms['webstudio.manage_reports'], ['r']);
  assert.deepEqual(sessionOfProfile('viewer').perms['webstudio.manage_reports'], ['r']);
  assert.equal(hasFlag(sessionOfProfile('viewer'), 'webstudio.manage_reports', 'r'), true);
  assert.equal(hasFlag(sessionWith({ 'webstudio.manage_content': { r: true } }), 'webstudio.manage_reports', 'r'), false);
  // Holding it gives nothing else: reports are not content, and it never takes the editor lock.
  const reportsOnly = sessionWith({ 'webstudio.manage_reports': { c: true, r: true, u: true, d: true, x: true, export: true, use_ai: true } });
  assert.equal(allowed(reportsOnly, 'GET', '/ycode/api/collections'), false);
  assert.equal(allowed(reportsOnly, 'GET', '/ycode/api/form-submissions'), false);
  assert.equal(isEditingWrite({ kind: 'leaf', leaf: 'webstudio.manage_reports', flag: 'c' }, 'POST'), false);
  // Session W9: the Reports API for the app, and nothing else is on the leaf.
  const onReports = Object.entries(API_ROUTE_ACCESS).filter(([, rule]) => rule.kind === 'leaf' && rule.leaf === 'webstudio.manage_reports').map(([pattern]) => pattern).sort();
  assert.deepEqual(onReports, ['platform/reports/summary', 'platform/sites/[id]/reports/conversions', 'platform/sites/[id]/reports/traffic']);
  const site = '3f0b2c7e-2d7a-4c3e-9a1e-7b1d2e3f4a5b';
  for (const pathname of [`/ycode/api/platform/sites/${site}/reports/traffic`, `/ycode/api/platform/sites/${site}/reports/conversions`, '/ycode/api/platform/reports/summary']) {
    assert.deepEqual(accessFor(pathname, 'GET', q('period=today')), { kind: 'leaf', leaf: 'webstudio.manage_reports', flag: 'r' }, pathname);
    // A Viewer reads them; a user with the other four leaves and no reports leaf does not; the reports leaf opens nothing else.
    assert.equal(allowed(sessionOfProfile('viewer'), 'GET', pathname), true, pathname);
    assert.equal(allowed(sessionWith({ 'webstudio.manage_sites': { r: true }, 'webstudio.manage_content': { r: true }, 'webstudio.manage_forms': { r: true }, 'webstudio.manage_orders': { r: true } }), 'GET', pathname), false, pathname);
  }
});

test('a path under /ycode/api that no route names is unmapped; the preview and templates bridge are gated; other paths are not this map\'s', () => {
  assert.deepEqual(accessFor('/ycode/api/nothing/here', 'GET', q()), { kind: 'unmapped' });
  assert.deepEqual(accessFor('/ycode/api', 'GET', q()), { kind: 'unmapped' });
  assert.deepEqual(accessFor('/ycode/preview/p1', 'GET', q()), { kind: 'leaf', leaf: 'webstudio.manage_content', flag: 'r' });
  assert.deepEqual(accessFor('/api/templates', 'GET', q()), { kind: 'leaf', leaf: 'webstudio.manage_content', flag: 'r' });
  assert.deepEqual(accessFor('/api/templates/export-and-upload', 'POST', q()), { kind: 'leaf', leaf: 'webstudio.manage_content', flag: 'export' });
  assert.equal(accessFor('/ycode', 'GET', q()), null);
  assert.equal(accessFor('/about', 'GET', q()), null);
  assert.equal(accessFor('/api/other', 'GET', q()), null);
});

test('the requirement is named the way the permission matrix shows it', () => {
  assert.equal(requirementName({ leaf: 'webstudio.manage_sites', flag: 'c' }), 'webstudio.manage_sites.c');
});

test('session 6: the writes that need the editor lock are the builder\'s non-read content and forms routes', () => {
  const writes = (method: string, pathname: string, query = '') => {
    const decision = accessFor(pathname, method, q(query));
    assert.ok(decision, `${method} ${pathname} is mapped`);
    return isEditingWrite(decision, method);
  };
  // Reads and the reads that use POST.
  assert.equal(writes('GET', '/ycode/api/pages'), false);
  assert.equal(writes('GET', '/ycode/api/editor/init'), false);
  assert.equal(writes('POST', '/ycode/api/platform/site-lock'), false);
  assert.equal(writes('DELETE', '/ycode/api/platform/site-lock'), false);
  assert.equal(writes('POST', '/ycode/api/project/export'), false);
  assert.equal(writes('POST', '/ycode/api/collections/items/batch'), false);
  // The sites API is not the open site's content.
  assert.equal(writes('POST', '/ycode/api/platform/sites'), false);
  assert.equal(writes('DELETE', '/ycode/api/platform/sites/5f1a4b0e-0000-4000-8000-000000000000'), false);
  assert.equal(writes('PATCH', '/ycode/api/platform/sites/5f1a4b0e-0000-4000-8000-000000000000/store'), false);
  // Writes.
  assert.equal(writes('PUT', '/ycode/api/pages/abc'), true);
  assert.equal(writes('POST', '/ycode/api/pages'), true);
  assert.equal(writes('DELETE', '/ycode/api/pages/abc'), true);
  assert.equal(writes('PUT', '/ycode/api/layers'), true);
  assert.equal(writes('POST', '/ycode/api/publish'), true);
  assert.equal(writes('POST', '/ycode/api/revert'), true);
  assert.equal(writes('POST', '/ycode/api/assets/upload'), true);
  assert.equal(writes('PUT', '/ycode/api/settings/site_name'), true);
  assert.equal(writes('POST', '/ycode/api/ai/chat'), true);
  assert.equal(writes('POST', '/ycode/api/collections'), true);
  // Anonymous and public routes never reach the lock.
  assert.equal(writes('POST', '/ycode/api/form-submissions'), false);
  assert.equal(isEditingWrite({ kind: 'public' }, 'POST'), false);
  assert.equal(isEditingWrite({ kind: 'session' }, 'POST'), false);
});

test('session 6: every non-GET route of the content leaf is either a lock-guarded write or named as a read', () => {
  // A new content POST route defaults to flag c and so to the lock; a read that uses POST must say 'r'.
  const readsByPost = Object.entries(API_ROUTE_ACCESS)
    .filter(([, rule]) => rule.kind === 'leaf' && (rule.flags?.POST === 'r' || rule.flags?.DELETE === 'r'))
    .map(([pattern]) => pattern)
    .sort();
  assert.deepEqual(readsByPost, ['collections/items/batch', 'collections/items/slugs', 'platform/site-lock']);
});

test('open question 18: only a user who may change content holds the editor lock', () => {
  assert.equal(mayHoldSiteLock({ 'webstudio.manage_content': ['c', 'r', 'u'] }), true);
  assert.equal(mayHoldSiteLock({ 'webstudio.manage_sites': ['r'], 'webstudio.manage_content': ['r'] }), false);
  assert.equal(mayHoldSiteLock({}), false);
});
