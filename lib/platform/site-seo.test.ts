import assert from 'node:assert/strict';
import { test } from 'node:test';

import { pageTitle } from './site-seo';

test('a page with no SEO title and no name is titled with the site\'s name (part 3, carried from part 1: OPEN_QUESTIONS 17)', () => {
  assert.equal(pageTitle({ title: null, pageName: '', siteName: 'Al Noor Trading', fallbackTitle: 'Home' }), 'Al Noor Trading');
  assert.equal(pageTitle({ title: undefined, pageName: undefined, siteName: 'Al Noor Trading', fallbackTitle: 'Home' }), 'Al Noor Trading');
  assert.equal(pageTitle({ title: '', pageName: '   ', siteName: 'Al Noor Trading' }), 'Al Noor Trading');
});

test('the site\'s name comes after what the page says of itself: its SEO title, then its name', () => {
  assert.equal(pageTitle({ title: 'Contact us today', pageName: 'Contact', siteName: 'Al Noor Trading' }), 'Contact us today');
  assert.equal(pageTitle({ title: null, pageName: 'Contact', siteName: 'Al Noor Trading' }), 'Contact');
});

test('with no site name either, the caller\'s fallback and then "Page" are still the last resort', () => {
  assert.equal(pageTitle({ title: null, pageName: '', siteName: null, fallbackTitle: 'Home' }), 'Home');
  assert.equal(pageTitle({ title: null, pageName: '', siteName: '  ', fallbackTitle: undefined }), 'Page');
});
