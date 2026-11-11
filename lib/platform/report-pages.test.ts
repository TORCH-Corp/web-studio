import assert from 'node:assert/strict';
import { test } from 'node:test';

import { pageNamer, type FolderRecord, type PageRecord } from './report-pages';

/**
 * The name of the page behind a visited path (part 3, session W9; PRD V1.0 "Traffic report", "the most viewed
 * pages"). The totals keep a page's path, not its id, so the name is found from the site's pages: its folders, its
 * index pages, its dynamic pages, and the language code a translated page's path begins with.
 */

const page = (id: string, name: string, slug: string, extra: Partial<PageRecord> = {}): PageRecord => ({
  id,
  name,
  slug,
  is_index: false,
  is_dynamic: false,
  page_folder_id: null,
  ...extra,
});
const folder = (id: string, slug: string, parent: string | null = null): FolderRecord => ({ id, slug, page_folder_id: parent });

const FOLDERS = [folder('f-company', 'company'), folder('f-team', 'team', 'f-company'), folder('f-blog', 'blog')];
const PAGES: PageRecord[] = [
  page('p-home', 'Home', '', { is_index: true }),
  page('p-about', 'About us', 'about'),
  page('p-contact', 'Contact', 'contact', { page_folder_id: 'f-company' }),
  page('p-company', 'Company', '', { is_index: true, page_folder_id: 'f-company' }),
  page('p-people', 'People', 'people', { page_folder_id: 'f-team' }),
  page('p-blog', 'Blog', '', { is_index: true, page_folder_id: 'f-blog' }),
  page('p-post', 'Blog post', '', { is_dynamic: true, page_folder_id: 'f-blog' }),
  page('p-new', 'What is new', 'new', { page_folder_id: 'f-blog' }),
];

const nameOf = pageNamer(PAGES, FOLDERS, ['en', 'ar']);

test('a page is found by its full path: the index page is the root, a folder\'s index is the folder', () => {
  assert.equal(nameOf('/'), 'Home');
  assert.equal(nameOf('/about'), 'About us');
  assert.equal(nameOf('/company'), 'Company');
  assert.equal(nameOf('/company/contact'), 'Contact');
  assert.equal(nameOf('/company/team/people'), 'People');
  assert.equal(nameOf('/blog'), 'Blog');
});

test('a dynamic page is the name of every path its collection makes, and a page of its own wins over it', () => {
  assert.equal(nameOf('/blog/hello-world'), 'Blog post');
  assert.equal(nameOf('/blog/another-one'), 'Blog post');
  assert.equal(nameOf('/blog/new'), 'What is new');
  // The pattern is one segment: a path deeper than the page has no name.
  assert.equal(nameOf('/blog/hello-world/comments'), null);
});

test('a path that begins with one of the site\'s language codes is the same page', () => {
  assert.equal(nameOf('/ar'), 'Home');
  assert.equal(nameOf('/ar/about'), 'About us');
  assert.equal(nameOf('/en/company/contact'), 'Contact');
  assert.equal(nameOf('/ar/blog/hello-world'), 'Blog post');
  // Only the site's own codes: /fr is not one, so /fr/about is not the about page.
  assert.equal(nameOf('/fr/about'), null);
  // A page whose slug is a language code is that page, not a translation of the home page.
  const odd = pageNamer([page('p-home', 'Home', '', { is_index: true }), page('p-en', 'English page', 'en')], [], ['en']);
  assert.equal(odd('/en'), 'English page');
  assert.equal(odd('/'), 'Home');
});

test('a path no page has has no name: a page since deleted, or renamed in its slug', () => {
  assert.equal(nameOf('/old-offer'), null);
  assert.equal(nameOf('/about/team'), null);
  assert.equal(nameOf(''), null);
});

test('slugs that are not ASCII are compared as the visit stores them, decoded', () => {
  const arabic = pageNamer([page('p1', 'من نحن', 'من-نحن')], [], []);
  assert.equal(arabic('/من-نحن'), 'من نحن');
});

test('no page and no folder is no name', () => {
  assert.equal(pageNamer([], [], [])('/'), null);
});
