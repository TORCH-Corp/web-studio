import assert from 'node:assert/strict';
import { test } from 'node:test';

import { isReadOnly, viewFromAnswer, type SiteLockView } from './site-lock-client';

const unknown: SiteLockView = { held: null, editor: null };
const holder = { name: 'Ali Editor', since: '2026-11-02T08:00:00.000Z' };

test('another user\'s lock makes the builder read-only and names the editor', () => {
  const { next, reload } = viewFromAnswer(unknown, { held: false, holder });
  assert.equal(isReadOnly(next), true);
  assert.deepEqual(next.editor, holder);
  assert.equal(reload, false);
});

test('holding the lock is not read-only, and nothing is known before the first answer', () => {
  assert.equal(isReadOnly(unknown), false);
  const { next, reload } = viewFromAnswer(unknown, { held: true, holder: { ...holder, name: 'Me' } });
  assert.equal(isReadOnly(next), false);
  assert.equal(next.editor, null);
  assert.equal(reload, false);
});

test('a read-only builder that gets the lock reloads once, to show the editor\'s changes', () => {
  const readOnly = viewFromAnswer(unknown, { held: false, holder }).next;
  assert.equal(viewFromAnswer(readOnly, { held: true, holder }).reload, true);
  const editing = viewFromAnswer(readOnly, { held: true, holder }).next;
  assert.equal(viewFromAnswer(editing, { held: true, holder }).reload, false);
});

test('losing the lock to another user turns an editing builder read-only without a reload', () => {
  const editing = viewFromAnswer(unknown, { held: true, holder }).next;
  const { next, reload } = viewFromAnswer(editing, { held: false, holder });
  assert.equal(isReadOnly(next), true);
  assert.equal(reload, false);
});

test('a lock that vanished between the refusal and the read leaves a read-only builder with no name', () => {
  const { next } = viewFromAnswer(unknown, { held: false, holder: null });
  assert.equal(isReadOnly(next), true);
  assert.equal(next.editor, null);
});
