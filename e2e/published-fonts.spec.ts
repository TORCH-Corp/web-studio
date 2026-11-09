/**
 * Part 2, session 26 (F3): a published page loads its site's Google font from
 * the platform's font mirror on the site's own host, never from
 * fonts.googleapis.com or fonts.gstatic.com (OPEN_QUESTIONS 60 of
 * features/storefront-and-cart; the fork's rule: no runtime dependency on a
 * public CDN).
 *
 * A site installs IBM Plex Sans Arabic, as TORCH's templates do, sets it on the
 * page's body and publishes. The page then names no Google host, in its HTML
 * or in its response headers, and a real browser that opens it contacts the
 * site's own host only. The mirror reads the family from Google on the server
 * the first time: where the run has no network the page is served without the
 * font, which the spec allows, and still names no public host.
 */

import { expect, request, test, type APIRequestContext } from '@playwright/test';
import { createSite, draftPages, openSite, publish, signIn, TEST_SITES_DOMAIN, type SiteRecord } from './helpers';

test.describe.configure({ mode: 'serial' });

const RUN = Date.now().toString(36);
const SLUG = `fonts-${RUN}`;
const HOST = `${SLUG}.${TEST_SITES_DOMAIN}`;
const OWNER = { sub: '86868686-8686-4686-8686-868686868686', email: 'owner-fonts@example.com', name: 'Fonts Owner', org: '87878787-8787-4787-8787-878787878787' };
const FILES = '/ycode/api/fonts/published';

let baseURL: string;
let owner: APIRequestContext;
let site: SiteRecord;
let html: string;
let linkHeader: string;

const text = (id: string, name: string, tag: string, value: string) => ({
  id, name, classes: 'text-[32px] font-bold', settings: { tag }, children: [],
  variables: { text: { type: 'dynamic_rich_text', data: { content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: value }] }] } } } },
});

test.beforeAll(async ({ baseURL: configured }) => {
  baseURL = configured!;
  owner = await signIn(baseURL, OWNER);
  site = await createSite(owner, { name: 'Fonts', slug: SLUG, languages: ['ar', 'en'], default_language: 'ar' });
  expect((await openSite(owner, site.id)).status()).toBe(303);

  // The font as the builder installs a Google font, and the page's body set in it.
  const installed = await owner.post('/ycode/api/fonts', { data: { name: 'ibm-plex-sans-arabic', family: 'IBM Plex Sans Arabic', type: 'google', variants: [], weights: ['400', '700'], category: 'sans-serif' } });
  expect(installed.status() < 300, await installed.text()).toBe(true);
  const home = (await draftPages(owner)).find((page) => page.is_index)!;
  const saved = await owner.put(`/ycode/api/layers?page_id=${home.id}`, { data: { layers: [{ id: 'body', name: 'body', classes: 'font-[IBM_Plex_Sans_Arabic]', children: [text('title', 'heading', 'h1', 'مرحبًا بكم في المتجر')] }] } });
  expect(saved.status(), await saved.text()).toBe(200);
  await publish(owner);

  const visitor = await request.newContext({ baseURL, extraHTTPHeaders: { 'x-forwarded-host': HOST } });
  try {
    const response = await visitor.get('/');
    expect(response.status()).toBe(200);
    html = await response.text();
    linkHeader = response.headers().link ?? '';
  } finally {
    await visitor.dispose();
  }
});

test.afterAll(async () => {
  if (site) await owner.delete(`/ycode/api/platform/sites/${site.id}`);
  await owner?.dispose();
});

test('a published page with a Google font names no Google host: not in its HTML, not in its response headers', () => {
  expect(html).toContain('مرحبًا بكم في المتجر');
  // The class that sets the family is there whether or not the mirror could be asked.
  expect(html).toContain('IBM Plex Sans Arabic');
  expect(html).not.toMatch(/fonts\.gstatic\.com|fonts\.googleapis\.com/);
  expect(linkHeader).not.toMatch(/gstatic|googleapis/);
});

test('the font\'s rules are inlined from the mirror with their files on the site\'s own host, the heading\'s file is preloaded, and the anonymous route serves those files only', async () => {
  const anonymous = await request.newContext({ baseURL, extraHTTPHeaders: { 'x-forwarded-host': HOST } });
  try {
    // Whatever the page names, the route refuses a file no published page names, a path that is not a font file, and a way out of the mirror.
    expect((await anonymous.get(`${FILES}/inter/v18/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuLyfAZ9hiA.woff2`)).status()).toBe(404);
    expect((await anonymous.get(`${FILES}/ibmplexsansarabic/v15/not-a-file-of-the-sheet.woff2`)).status()).toBe(404);
    expect((await anonymous.get(`${FILES}/ibmplexsansarabic/x.woff2`)).status()).toBe(404);
    expect((await anonymous.get(`${FILES}/..%2F..%2Fetc/v1/passwd.woff2`)).status()).toBe(404);
    // The mirror's own routes are still the signed-in builder's.
    expect((await anonymous.get('/ycode/api/fonts/mirror/css2?family=IBM+Plex+Sans+Arabic:wght@400;700&display=swap')).status()).toBe(401);

    const rules = /<style id="ycode-google-fonts">([\s\S]*?)<\/style>/.exec(html)?.[1];
    test.skip(!rules, 'the mirror could not read the family from Google in this run (no network): the page is served without the font');
    const files = [...new Set(Array.from(rules!.matchAll(/url\(([^)]+)\)/g), (match) => match[1]))];
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) expect(file.startsWith(`${FILES}/ibmplexsansarabic/`), file).toBe(true);
    expect(rules).toContain('IBM Plex Sans Arabic');

    // The heading's file is preloaded from the same place.
    const preload = /<link rel="preload" as="font" href="([^"]+)"/.exec(html)?.[1];
    expect(preload, 'the font file of the first heading is preloaded').toBeTruthy();
    expect(files).toContain(preload);

    const served = await anonymous.get(files[0]);
    expect(served.status()).toBe(200);
    expect(served.headers()['content-type']).toBe('font/woff2');
    expect(served.headers()['cache-control']).toContain('immutable');
    expect((await served.body()).subarray(0, 4).toString('latin1')).toBe('wOF2');
  } finally {
    await anonymous.dispose();
  }
});

test('a real browser that opens the page contacts the site\'s own host only, and shows the text in the font when the mirror has it', async ({ browser }) => {
  const context = await browser.newContext({ baseURL, extraHTTPHeaders: { 'x-forwarded-host': HOST } });
  const hosts = new Set<string>();
  context.on('request', (req) => {
    const url = new URL(req.url());
    if (['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol)) hosts.add(url.host);
  });
  try {
    const page = await context.newPage();
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'مرحبًا بكم في المتجر' })).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await page.waitForLoadState('networkidle');
    expect(await page.locator('body').evaluate((el) => getComputedStyle(el).fontFamily)).toContain('IBM Plex Sans Arabic');
    if (html.includes('id="ycode-google-fonts"')) {
      // The Arabic heading made the browser fetch the Arabic subset, from this host.
      expect(await page.evaluate(() => [...document.fonts].some((face) => face.family.includes('IBM Plex Sans Arabic') && face.status === 'loaded'))).toBe(true);
    }
  } finally {
    await context.close();
  }
  expect([...hosts], 'hosts the published page contacted').toEqual([new URL(baseURL).host]);
});
