import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseSiteSettingsPatch, planLanguages } from './site-settings-input';

const ok = (body: unknown) => {
  const result = parseSiteSettingsPatch(body);
  assert.equal(result.errors, null, JSON.stringify(result.errors));
  return result.patch!;
};
const bad = (body: unknown) => {
  const result = parseSiteSettingsPatch(body);
  assert.equal(result.patch, null);
  return result.errors!;
};

test('a patch names only what changes', () => {
  assert.deepEqual(ok({}), {});
  assert.deepEqual(ok({ name: '  Al Noor  ' }), { name: 'Al Noor' });
  assert.deepEqual(ok({ slug: 'Al-Noor' }), { slug: 'al-noor' });
  assert.deepEqual(ok({ languages: ['en', 'ar', 'en'], default_language: 'ar' }), { languages: ['en', 'ar'], default_language: 'ar' });
});

test('custom_host is a lower-case host name, and null or empty removes it', () => {
  assert.equal(ok({ custom_host: ' WWW.Example.com ' }).custom_host, 'www.example.com');
  assert.equal(ok({ custom_host: null }).custom_host, null);
  assert.equal(ok({ custom_host: '' }).custom_host, null);
  assert.match(bad({ custom_host: 'https://example.com' })[0], /^custom_host:/);
  assert.match(bad({ custom_host: 'localhost' })[0], /^custom_host:/);
});

test('seo values can be cleared with null or an empty string; the image is an asset id', () => {
  const id = '3f0b2c7e-2d7a-4c3e-9a1e-7b1d2e3f4a5b';
  assert.deepEqual(ok({ seo: { title: 'Al Noor', description: '', image: id } }).seo, { title: 'Al Noor', description: null, image: id });
  assert.deepEqual(ok({ seo: { title: null, image: null } }).seo, { title: null, image: null });
  assert.match(bad({ seo: { image: 'logo.png' } })[0], /^seo\.image:/);
  assert.match(bad({ seo: { title: 'x'.repeat(256) } })[0], /^seo\.title:/);
});

test('bad bodies are refused with the field named', () => {
  assert.match(bad({ name: '   ' })[0], /^name:/);
  assert.match(bad({ slug: 'Bad Slug' })[0], /^slug:/);
  assert.match(bad({ languages: [] })[0], /^languages:/);
  assert.match(bad({ languages: ['fr'] })[0], /^languages\.0:/);
  assert.match(bad({ languages: ['en'], default_language: 'ar' })[0], /^default_language:/);
  assert.ok(bad({ colour: 'red' }).length > 0, 'unknown keys are refused, so a typo is not silently ignored');
});

const arEn = [{ code: 'ar', is_default: true }, { code: 'en', is_default: false }];

test('planLanguages: adding, removing and moving the default', () => {
  assert.deepEqual(planLanguages([{ code: 'ar', is_default: true }], ['ar', 'en'], undefined), { add: ['en'], remove: [], defaultCode: 'ar' });
  assert.deepEqual(planLanguages(arEn, ['ar'], undefined), { add: [], remove: ['en'], defaultCode: 'ar' });
  assert.deepEqual(planLanguages(arEn, ['en'], 'en'), { add: [], remove: ['ar'], defaultCode: 'en' });
  assert.deepEqual(planLanguages(arEn, undefined, 'en'), { add: [], remove: [], defaultCode: 'en' });
  assert.deepEqual(planLanguages(arEn, ['ar', 'en'], undefined), { add: [], remove: [], defaultCode: 'ar' });
});

test('planLanguages: removing the default needs a new one', () => {
  const plan = planLanguages(arEn, ['en'], undefined);
  assert.ok('error' in plan && /default_language is required/.test(plan.error));
  const outside = planLanguages(arEn, undefined, 'fr');
  assert.ok('error' in outside);
});
