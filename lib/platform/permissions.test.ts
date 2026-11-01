import assert from 'node:assert/strict';
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import { API_ROUTE_ACCESS, accessFor, flagForMethod, isEditingWrite, matchApiRoute, requirementName } from './permissions';

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
  assert.deepEqual(accessFor('/ycode/api/pages', 'POST', q()), { kind: 'leaf', leaf: 'webstudio.manage_content', flag: 'c' });
  assert.deepEqual(accessFor('/ycode/api/pages/abc/status', 'POST', q()), { kind: 'leaf', leaf: 'webstudio.manage_content', flag: 'u' });
  assert.deepEqual(accessFor('/ycode/api/publish', 'POST', q()), { kind: 'leaf', leaf: 'webstudio.manage_content', flag: 'u' });
  assert.deepEqual(accessFor('/ycode/api/project/export', 'POST', q()), { kind: 'leaf', leaf: 'webstudio.manage_content', flag: 'export' });
  assert.deepEqual(accessFor('/ycode/api/apps/static-export/export', 'POST', q()), { kind: 'leaf', leaf: 'webstudio.manage_content', flag: 'export' });
  assert.deepEqual(accessFor('/ycode/api/ai/chat', 'POST', q()), { kind: 'leaf', leaf: 'webstudio.manage_content', flag: 'use_ai' });
  assert.deepEqual(accessFor('/ycode/api/collections/items/delete', 'POST', q()), { kind: 'leaf', leaf: 'webstudio.manage_forms', flag: 'd' });
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
  assert.deepEqual(accessFor('/ycode/api/v1/forms/f1/submissions', 'POST', q()), { kind: 'public' });
  assert.deepEqual(accessFor('/ycode/api/oauth/authorize', 'POST', q()), { kind: 'session' });
  assert.deepEqual(accessFor('/ycode/api/icons', 'GET', q('search=home')), { kind: 'leaf', leaf: 'webstudio.manage_content', flag: 'r' });

  assert.deepEqual(accessFor('/ycode/api/form-submissions', 'POST', q()), { kind: 'public' });
  assert.deepEqual(accessFor('/ycode/api/form-submissions', 'GET', q()), { kind: 'leaf', leaf: 'webstudio.manage_forms', flag: 'r' });
  assert.deepEqual(accessFor('/ycode/api/error-page', 'GET', q('code=404&published=true')), { kind: 'public' });
  assert.deepEqual(accessFor('/ycode/api/error-page', 'GET', q('code=404')), { kind: 'leaf', leaf: 'webstudio.manage_content', flag: 'r' });
  assert.deepEqual(accessFor('/ycode/api/collections/c1/items/filter', 'POST', q()), { kind: 'public' });
  assert.deepEqual(accessFor('/ycode/api/collections/c1/items/load-more', 'POST', q()), { kind: 'public' });
  assert.deepEqual(accessFor('/ycode/api/collections/c1/items/i1', 'POST', q()), { kind: 'leaf', leaf: 'webstudio.manage_forms', flag: 'c' });
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
