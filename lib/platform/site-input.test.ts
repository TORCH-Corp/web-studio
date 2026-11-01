import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseSiteInput } from './site-input';

const valid = { name: 'Al Noor Trading', slug: 'al-noor', languages: ['ar', 'en'], default_language: 'ar' };

test('a complete body is accepted with hosts defaulting to none', () => {
  const { input, errors } = parseSiteInput(valid);
  assert.equal(errors, null);
  assert.deepEqual(input, { ...valid, hosts: [] });
});

test('slug and hosts are trimmed and lower-cased, duplicates dropped', () => {
  const { input } = parseSiteInput({
    ...valid,
    slug: '  Al-Noor ',
    languages: ['en', 'en', 'ar'],
    hosts: ['Shop.Example.COM ', 'shop.example.com', 'alnoor.iq'],
  });
  assert.equal(input?.slug, 'al-noor');
  assert.deepEqual(input?.languages, ['en', 'ar']);
  assert.deepEqual(input?.hosts, ['shop.example.com', 'alnoor.iq']);
});

test('a slug that is not one DNS label is refused', () => {
  for (const slug of ['', '-noor', 'noor-', 'al noor', 'al.noor', 'a'.repeat(64), 'عربي']) {
    const { errors } = parseSiteInput({ ...valid, slug });
    assert.ok(errors?.some((e) => e.startsWith('slug:')), `slug "${slug}" should be refused`);
  }
});

test('the default language must be one of the chosen languages', () => {
  const { errors } = parseSiteInput({ ...valid, languages: ['en'], default_language: 'ar' });
  assert.deepEqual(errors, ['default_language: default_language must be one of languages']);
});

test('only Arabic and English exist in part 1, and at least one is required', () => {
  assert.ok(parseSiteInput({ ...valid, languages: ['fr', 'ar'] }).errors?.some((e) => e.startsWith('languages.0')));
  assert.ok(parseSiteInput({ ...valid, languages: [] }).errors?.some((e) => e.startsWith('languages')));
});

test('a host that is not a host name is refused', () => {
  for (const host of ['localhost', 'http://shop.example.com', 'shop.example.com/path', 'bad_host.example.com']) {
    const { errors } = parseSiteInput({ ...valid, hosts: [host] });
    assert.ok(errors?.some((e) => e.startsWith('hosts.0')), `host "${host}" should be refused`);
  }
});

test('a template id is accepted when it is a uuid', () => {
  assert.equal(parseSiteInput({ ...valid, template_id: '3f0b2c7e-2d7a-4c3e-9a1e-7b1d2e3f4a5b' }).errors, null);
  assert.ok(parseSiteInput({ ...valid, template_id: 'company-site' }).errors?.some((e) => e.startsWith('template_id')));
});

test('a missing name is refused', () => {
  const { errors } = parseSiteInput({ ...valid, name: '   ' });
  assert.deepEqual(errors, ['name: name is required']);
});
