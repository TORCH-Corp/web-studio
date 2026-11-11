/**
 * Part 3, session W10 (carried from part 1: OPEN_QUESTIONS 17 of
 * features/sites-and-publishing; notebook decision 12): a published page carries
 * the site's name.
 *
 *   - `og:site_name` is on every page, in every language, whatever the page's own
 *     SEO fields say;
 *   - a page's `<title>` is its SEO title, else its name (the site's name is the
 *     last resort: lib/platform/site-seo.test.ts covers a page with no name);
 *   - changing the name in Site settings shows on the published pages after the
 *     next publish.
 */

import { expect, test, type APIRequestContext } from '@playwright/test';
import { createSite, draftPages, openSite, publish, publishedSite, setHeading, signIn, TEST_SITES_DOMAIN, type SiteRecord } from './helpers';

test.describe.configure({ mode: 'serial' });

const RUN = Date.now().toString(36);
const SLUG = `name-${RUN}`;
const HOST = `${SLUG}.${TEST_SITES_DOMAIN}`;
const OWNER = { sub: '8a8a8a8a-8a8a-48a8-88a8-8a8a8a8a8a8a', email: 'owner-site-name@example.com', name: 'Site Name Owner', org: '8b8b8b8b-8b8b-48b8-88b8-8b8b8b8b8b8b' };

let baseURL: string;
let owner: APIRequestContext;
let site: SiteRecord;

/** A published page's `<head>` as a visitor's browser gets it. */
async function head(path: string): Promise<{ title: string; siteNames: string[] }> {
  const anonymous = await publishedSite(baseURL, HOST);
  try {
    const response = await anonymous.get(path);
    expect(response.status(), path).toBe(200);
    const html = await response.text();
    return {
      title: /<title>([^<]*)<\/title>/.exec(html)?.[1] ?? '',
      siteNames: Array.from(html.matchAll(/<meta property="og:site_name" content="([^"]*)"/g), (match) => match[1]),
    };
  } finally {
    await anonymous.dispose();
  }
}

test.beforeAll(async ({ baseURL: configured }) => {
  baseURL = configured!;
  owner = await signIn(baseURL, OWNER);
  site = await createSite(owner, { name: 'Al Noor Trading', slug: SLUG, languages: ['en', 'ar'], default_language: 'en' });
  expect((await openSite(owner, site.id)).status()).toBe(303);

  const home = (await draftPages(owner)).find((page) => page.is_index)!;
  await setHeading(owner, home.id, 'Welcome');

  // A page with no SEO title of its own, and one that has.
  const plain = await owner.post('/ycode/api/pages', { data: { name: 'About us', slug: 'about' } });
  expect(plain.status() < 300, await plain.text()).toBe(true);
  const titled = await owner.post('/ycode/api/pages', { data: { name: 'Contact', slug: 'contact', settings: { seo: { title: 'Get in touch | Al Noor' } } } });
  expect(titled.status() < 300, await titled.text()).toBe(true);
  await publish(owner);
});

test.afterAll(async () => {
  if (site) await owner.delete(`/ycode/api/platform/sites/${site.id}`);
  await owner?.dispose();
});

test('every published page names the site once as og:site_name, in the default language and under /ar, with or without an SEO title', async () => {
  for (const path of ['/', '/about', '/contact', '/ar', '/ar/about']) {
    expect((await head(path)).siteNames, path).toEqual(['Al Noor Trading']);
  }
});

test('a page\'s title is its SEO title, else its name: the site\'s name does not replace either', async () => {
  expect((await head('/contact')).title).toBe('Get in touch | Al Noor');
  expect((await head('/about')).title).toBe('About us');
});

test('a new name in Site settings shows on the published pages after the next publish', async () => {
  const renamed = await owner.patch(`/ycode/api/platform/sites/${site.id}/settings`, { data: { name: 'Al Noor Group' } });
  expect(renamed.status(), await renamed.text()).toBe(200);
  await publish(owner);
  for (const path of ['/', '/about', '/contact', '/ar']) {
    expect((await head(path)).siteNames, path).toEqual(['Al Noor Group']);
  }
});
