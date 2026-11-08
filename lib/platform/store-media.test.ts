import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { createStoreMediaCache, RECHECK_MS, RETRY_MS, StoreMediaUnavailableError, type MediaSource } from './store-media';

const ORG = '0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a';
const DOC = 'c00cac12-a315-45dd-81ba-0d9f8193ac93';
const PNG = Buffer.from('89504e470d0a1a0a0001', 'hex');
const PNG_V2 = Buffer.from('89504e470d0a1a0a0002', 'hex');
const sha = (data: Buffer) => createHash('sha256').update(data).digest('hex');

/** A Document Center that counts its downloads and reads, with bytes and failures the test sets. */
function fakeSource() {
  const state = { data: PNG as Buffer | null, contentType: 'image/png' as string | null, failDownload: false, failRead: false, downloads: 0, reads: 0 };
  const source: MediaSource = {
    async download() {
      state.downloads += 1;
      if (state.failDownload) throw new Error('connect ECONNREFUSED');
      return state.data ? { data: state.data, contentType: state.contentType } : null;
    },
    async currentHash() {
      state.reads += 1;
      if (state.failRead) throw new Error('connect ECONNREFUSED');
      return state.data ? sha(state.data) : null;
    },
  };
  return { state, source };
}

async function setup() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'store-media-'));
  const clock = { now: Date.UTC(2026, 10, 8, 9) };
  const logs: string[] = [];
  const { state, source } = fakeSource();
  const cache = createStoreMediaCache({ dir, source, now: () => clock.now, log: (m) => logs.push(m) });
  return { dir, clock, logs, state, cache };
}

test('an image is downloaded once, kept under its document id and hash, and served from disk after that', async () => {
  const { dir, state, cache } = await setup();
  const first = await cache.get(ORG, DOC);
  assert.deepEqual(first?.data, PNG);
  assert.equal(first?.meta.sha256, sha(PNG));
  assert.equal(first?.meta.contentType, 'image/png');
  assert.deepEqual((await fs.readdir(path.join(dir, ORG, DOC))).sort(), ['current.json', sha(PNG)].sort());
  const again = await cache.get(ORG, DOC);
  assert.deepEqual(again?.data, PNG);
  assert.deepEqual([state.downloads, state.reads], [1, 0]);
  // A new process (a new cache over the same folder) still asks nothing.
  const { source } = fakeSource();
  const counted = { downloads: 0 };
  const restarted = createStoreMediaCache({ dir, source: { ...source, download: async (...args) => { counted.downloads += 1; return source.download(...args); } } });
  assert.deepEqual((await restarted.get(ORG, DOC))?.data, PNG);
  assert.equal(counted.downloads, 0);
});

test('requests at the same moment share one download', async () => {
  const { state, cache } = await setup();
  const all = await Promise.all([cache.get(ORG, DOC), cache.get(ORG, DOC), cache.get(ORG, DOC)]);
  assert.ok(all.every((file) => file?.data.equals(PNG)));
  assert.equal(state.downloads, 1);
});

test('once a day the copy is checked against the current version: the same hash downloads nothing, a new one replaces the copy', async () => {
  const { dir, clock, state, cache } = await setup();
  await cache.get(ORG, DOC);
  clock.now += RECHECK_MS - 1;
  await cache.get(ORG, DOC);
  assert.deepEqual([state.downloads, state.reads], [1, 0], 'not checked before a day has passed');
  clock.now += 1;
  assert.deepEqual((await cache.get(ORG, DOC))?.data, PNG);
  assert.deepEqual([state.downloads, state.reads], [1, 1], 'checked, not downloaded');
  await cache.get(ORG, DOC);
  assert.equal(state.reads, 1, 'the check counts as a day again');

  state.data = PNG_V2;
  clock.now += RECHECK_MS;
  const replaced = await cache.get(ORG, DOC);
  assert.deepEqual(replaced?.data, PNG_V2);
  assert.deepEqual([state.downloads, state.reads], [2, 2]);
  assert.deepEqual((await fs.readdir(path.join(dir, ORG, DOC))).sort(), ['current.json', sha(PNG_V2)].sort(), 'the old version is removed');
});

test('a document that is gone is forgotten at its check; one gone before its first fetch is not found', async () => {
  const { dir, clock, state, cache } = await setup();
  await cache.get(ORG, DOC);
  state.data = null;
  clock.now += RECHECK_MS;
  assert.equal(await cache.get(ORG, DOC), null);
  await assert.rejects(fs.stat(path.join(dir, ORG, DOC)), /ENOENT/);
  assert.equal(await cache.get(ORG, DOC), null);
});

test('while Document Center cannot be asked the stored copy is served, the failure logged and the check retried after ten minutes', async () => {
  const { clock, logs, state, cache } = await setup();
  await cache.get(ORG, DOC);
  state.failRead = true;
  clock.now += RECHECK_MS;
  assert.deepEqual((await cache.get(ORG, DOC))?.data, PNG);
  assert.equal(state.reads, 1);
  assert.match(logs[0], /daily check of image .* failed/);
  await cache.get(ORG, DOC);
  assert.equal(state.reads, 1, 'not asked again before ten minutes');
  state.failRead = false;
  clock.now += RETRY_MS;
  await cache.get(ORG, DOC);
  assert.equal(state.reads, 2);
});

test('an image not kept yet while Document Center cannot be reached is an error, and nothing is kept', async () => {
  const { dir, state, cache } = await setup();
  state.failDownload = true;
  await assert.rejects(cache.get(ORG, DOC), StoreMediaUnavailableError);
  await assert.rejects(fs.stat(path.join(dir, ORG, DOC)), /ENOENT/);
  state.failDownload = false;
  assert.deepEqual((await cache.get(ORG, DOC))?.data, PNG);
});

test('only raster images are kept: an SVG, a PDF or an unstated type is refused and logged', async () => {
  const { clock, logs, state, cache } = await setup();
  for (const contentType of ['image/svg+xml', 'application/pdf', null]) {
    state.contentType = contentType;
    assert.equal(await cache.get(ORG, DOC), null, String(contentType));
    clock.now += RECHECK_MS;
  }
  assert.equal(state.downloads, 3);
  assert.equal(logs.length, 3);
  assert.match(logs[0], /image\/svg\+xml, not an image the store serves/);
});

test('a refused document is not downloaded again on every view, only after its daily check', async () => {
  const { clock, logs, state, cache } = await setup();
  state.contentType = 'image/svg+xml';
  assert.equal(await cache.get(ORG, DOC), null);
  clock.now += RECHECK_MS - 1;
  assert.equal(await cache.get(ORG, DOC), null);
  assert.equal(await cache.get(ORG, DOC), null);
  assert.deepEqual([state.downloads, state.reads, logs.length], [1, 0, 1]);
  // A day on, it is asked again; it has become a PNG and is served from then on.
  state.contentType = 'image/png';
  clock.now += 1;
  assert.deepEqual((await cache.get(ORG, DOC))?.data, PNG);
  assert.deepEqual((await cache.get(ORG, DOC))?.data, PNG);
  assert.equal(state.downloads, 2);
});

test('a kept image whose new version is not an image is dropped and refused until its next check', async () => {
  const { dir, clock, state, cache } = await setup();
  await cache.get(ORG, DOC);
  state.data = PNG_V2;
  state.contentType = 'image/svg+xml';
  clock.now += RECHECK_MS;
  assert.equal(await cache.get(ORG, DOC), null);
  await assert.rejects(fs.stat(path.join(dir, ORG, DOC)), /ENOENT/, 'the copy of the earlier version is removed');
  assert.equal(await cache.get(ORG, DOC), null);
  assert.deepEqual([state.downloads, state.reads], [2, 1]);
});

test('ids that are not uuids never reach the disk', async () => {
  const { cache } = await setup();
  await assert.rejects(cache.get(ORG, '../../etc/passwd'), /uuids/);
  await assert.rejects(cache.get('..', DOC), /uuids/);
});
