import assert from 'node:assert/strict';
import { test } from 'node:test';

import { CMS_ROUTES, matchCmsRoute } from './cms-routes';
import { accessFor, API_ROUTE_ACCESS, isEditingWrite } from './permissions';

const C = '11111111-1111-4111-8111-111111111111';
const I = '22222222-2222-4222-8222-222222222222';
const CONTENT = 'webstudio.manage_content';

test('the app reaches the builder\'s collections routes by their own paths, with their own parameters', () => {
  assert.deepEqual(matchCmsRoute(['collections'], 'GET'), { key: 'collections', params: {}, requires: { leaf: CONTENT, flag: 'r' } });
  assert.deepEqual(matchCmsRoute(['collections', C, 'items', I], 'PUT'), { key: 'item', params: { id: C, item_id: I }, requires: { leaf: CONTENT, flag: 'u' } });
  assert.deepEqual(matchCmsRoute(['collections', C, 'fields', I], 'DELETE'), { key: 'field', params: { id: C, field_id: I }, requires: { leaf: CONTENT, flag: 'd' } });
  // A literal segment wins over the parameter it would be taken for.
  assert.equal(matchCmsRoute(['collections', C, 'items', 'reorder'], 'POST')?.key, 'itemsReorder');
  assert.equal(matchCmsRoute(['collections', C, 'fields', 'reorder'], 'PUT')?.key, 'fieldsReorder');
});

test('each write asks the flag the builder\'s route asks: a create c, a change u, a delete d', () => {
  const flag = (path: string[], method: string) => matchCmsRoute(path, method)?.requires.flag;
  assert.equal(flag(['collections'], 'POST'), 'c');
  assert.equal(flag(['collections', C], 'PUT'), 'u');
  assert.equal(flag(['collections', C], 'DELETE'), 'd');
  assert.equal(flag(['collections', C, 'items'], 'POST'), 'c');
  assert.equal(flag(['collections', C, 'items', I, 'duplicate'], 'POST'), 'c');
  assert.equal(flag(['collections', C, 'items', I, 'status'], 'PUT'), 'u');
  assert.equal(flag(['collections', C, 'items', 'reorder'], 'POST'), 'u');
  assert.equal(flag(['collections', C, 'publish'], 'POST'), 'u');
  assert.equal(flag(['translations'], 'POST'), 'c');
  assert.equal(flag(['locales'], 'GET'), 'r');
});

test('a path or a method that is not listed is none: the pass-through is no general door into the builder\'s API', () => {
  for (const [path, method] of [
    [['pages'], 'POST'],
    [['pages', C], 'GET'],
    [['publish'], 'POST'],
    [['collections', C, 'import'], 'POST'],
    [['collections', 'items', 'delete'], 'POST'],
    [['locales'], 'POST'],
    [['locales', C], 'DELETE'],
    [['translations', 'bulk'], 'POST'],
    [['collections', C, 'items', I, 'status'], 'GET'],
    [['collections', ''], 'GET'],
    [[], 'GET'],
  ] as const) {
    assert.equal(matchCmsRoute([...path], method), null, `${method} ${path.join('/')}`);
  }
});

test('every listed route is one the builder has, guarded by the content leaf', () => {
  for (const route of CMS_ROUTES) {
    const path = route.pattern.map((segment) => (segment.startsWith(':') ? C : segment));
    for (const method of route.methods) {
      const match = matchCmsRoute(path, method);
      assert.equal(match?.requires.leaf, CONTENT, `${method} ${route.pattern.join('/')}`);
    }
  }
});

test('the pass-through itself asks content r of every method and no editor lock (the owner\'s decision: the app edits alongside the builder)', () => {
  assert.ok(API_ROUTE_ACCESS['platform/sites/[id]/cms/[...path]']);
  for (const method of ['GET', 'POST', 'PUT', 'DELETE']) {
    const access = accessFor(`/ycode/api/platform/sites/${C}/cms/collections/${C}/items`, method, new URLSearchParams());
    assert.deepEqual(access, { kind: 'leaf', leaf: CONTENT, flag: 'r' }, method);
    assert.equal(isEditingWrite(access!, method), false, method);
  }
});
