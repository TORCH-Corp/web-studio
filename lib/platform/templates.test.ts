import assert from 'node:assert/strict';
import { test } from 'node:test';

import { templateLanguages } from './templates';

test('a template\'s languages are its locale codes, the default one first, the others by code', () => {
  assert.deepEqual(templateLanguages([{ code: 'ar', is_default: false }, { code: 'en', is_default: true }]), ['en', 'ar']);
  assert.deepEqual(templateLanguages([{ code: 'en', is_default: false }, { code: 'ar', is_default: true }]), ['ar', 'en']);
  assert.deepEqual(templateLanguages([{ code: 'fr', is_default: false }, { code: 'en', is_default: false }, { code: 'ar', is_default: true }]), ['ar', 'en', 'fr']);
  assert.deepEqual(templateLanguages([{ code: 'en', is_default: true }]), ['en']);
});

test('a template with no locale rows has no languages, and a code is listed once', () => {
  assert.deepEqual(templateLanguages([]), []);
  assert.deepEqual(templateLanguages([{ code: 'en', is_default: true }, { code: 'en', is_default: false }]), ['en']);
});
