import assert from 'node:assert/strict';
import { test } from 'node:test';

import { containsPattern, parseSiteAssetsQuery, SHARE_IMAGE_MIME_TYPES } from './site-assets-input';

const parse = (query: string) => parseSiteAssetsQuery(new URLSearchParams(query));

test('the defaults are the first page of 50, no search', () => {
  assert.deepEqual(parse('').query, { page: 1, limit: 50 });
  assert.deepEqual(parse('search=%20%20').query, { page: 1, limit: 50 });
});

test('search, page and limit are read and normalised', () => {
  assert.deepEqual(parse('search=%20logo%20&page=3&limit=20').query, { search: 'logo', page: 3, limit: 20 });
});

test('a page or limit out of range, or an unknown parameter, is refused with the field named', () => {
  for (const query of ['page=0', 'page=x', 'limit=0', 'limit=101', 'limit=2.5', 'folderId=abc']) {
    const result = parse(query);
    assert.equal(result.query, null, query);
    assert.ok(result.errors && result.errors.length > 0, query);
  }
  assert.match(parse('limit=101').errors![0], /^limit:/);
});

test('a search matches its text literally, wildcards included', () => {
  assert.equal(containsPattern('logo'), '%logo%');
  assert.equal(containsPattern('100%_off\\'), '%100\\%\\_off\\\\%');
});

test('share images are the bitmap types link previews show, never SVG', () => {
  assert.ok(SHARE_IMAGE_MIME_TYPES.includes('image/png'));
  assert.ok(SHARE_IMAGE_MIME_TYPES.includes('image/jpeg'));
  assert.ok(!SHARE_IMAGE_MIME_TYPES.includes('image/svg+xml'));
});
