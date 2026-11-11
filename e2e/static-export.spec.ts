/**
 * Part 3, session W10 (carried from part 2: OPEN_QUESTIONS 62 and 63 of
 * features/storefront-and-cart): what the static export writes into its files.
 *
 *   - 62: a store element's loading shell is in the page's language, on a page in
 *     the site's default language too (an Arabic-first site's root is Arabic,
 *     right to left); under /en it is English. The question describes the shell as
 *     English on a default-language page; on the code of 9 Nov this case already
 *     passed, because the engine gives its default pass the site's default locale
 *     (engine.ts, `ctx`). It stays as the guard of that: it fails when the default
 *     pass is given no locale;
 *   - 63: the site's Google font comes from the platform's font mirror, as on a
 *     published page (session 26): the export carries the font files, named
 *     relative to each page, and no file it writes names fonts.googleapis.com or
 *     fonts.gstatic.com.
 *
 * The mirror reads the family from Google on the server the first time: where the
 * run has no network the export has no font to carry, which the spec allows (the
 * font assertions skip), and still names no Google host.
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { createSite, draftPages, openSite, publish, signIn, type SiteRecord } from './helpers';

test.describe.configure({ mode: 'serial' });

const RUN = Date.now().toString(36);
const OWNER = { sub: '8c8c8c8c-8c8c-48c8-88c8-8c8c8c8c8c8c', email: 'owner-static-export@example.com', name: 'Export Owner', org: '8d8d8d8d-8d8d-48d8-88d8-8d8d8d8d8d8d' };

let baseURL: string;
let owner: APIRequestContext;
let site: SiteRecord;
let out: string;

const text = (id: string, name: string, tag: string, value: string) => ({
  id, name, classes: 'text-[32px] font-bold', settings: { tag }, children: [],
  variables: { text: { type: 'dynamic_rich_text', data: { content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: value }] }] } } } },
});
const grid = { id: 'grid', name: 'productGrid', classes: 'w-full', settings: { tag: 'div', store: { productGrid: { pageSize: 4 } } }, children: [] };
const cart = { id: 'cart', name: 'cartIndicator', classes: 'w-fit', settings: { tag: 'div' }, children: [] };

/** Every file under a directory, relative, with `/` separators. */
async function walk(dir: string, base = dir): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walk(full, base));
    else files.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return files;
}

test.beforeAll(async ({ baseURL: configured }) => {
  baseURL = configured!;
  owner = await signIn(baseURL, OWNER);
  // Arabic first, English second: the root and /ar-less pages are Arabic, /en is English.
  site = await createSite(owner, { name: 'Export', slug: `export-${RUN}`, languages: ['ar', 'en'], default_language: 'ar' });
  expect((await openSite(owner, site.id)).status()).toBe(303);

  const installed = await owner.post('/ycode/api/fonts', { data: { name: 'ibm-plex-sans-arabic', family: 'IBM Plex Sans Arabic', type: 'google', variants: [], weights: ['400', '700'], category: 'sans-serif' } });
  expect(installed.status() < 300, await installed.text()).toBe(true);
  const home = (await draftPages(owner)).find((page) => page.is_index)!;
  const saved = await owner.put(`/ycode/api/layers?page_id=${home.id}`, { data: { layers: [{ id: 'body', name: 'body', classes: 'font-[IBM_Plex_Sans_Arabic]', children: [text('title', 'heading', 'h1', 'مرحبًا بكم في المتجر'), cart, grid] }] } });
  expect(saved.status(), await saved.text()).toBe(200);
  await publish(owner);

  out = await fs.mkdtemp(path.join(os.tmpdir(), 'ws-export-'));
  const settings = await owner.put('/ycode/api/apps/static-export/settings', { data: {
    outputTargets: ['local'], localPath: out, s3Bucket: '', s3Region: '', s3AccessKey: '', s3SecretKey: '', githubRepo: '', githubBranch: 'main', githubToken: '', githubAuthorName: '', githubAuthorEmail: '',
  } });
  expect(settings.status(), await settings.text()).toBe(200);
  const started = await owner.post('/ycode/api/apps/static-export/export');
  expect(started.status(), await started.text()).toBe(200);
  let job: { status: string; error: string | null } | null = null;
  await expect.poll(async () => {
    job = (await (await owner.get('/ycode/api/apps/static-export/status')).json()).data;
    return job?.status;
  }, { timeout: 90_000 }).not.toBe('running');
  expect(job, 'the export finished').toMatchObject({ status: 'completed', error: null });
});

test.afterAll(async () => {
  if (site) await owner.delete(`/ycode/api/platform/sites/${site.id}`);
  await owner?.dispose();
  if (out) await fs.rm(out, { recursive: true, force: true });
});

test('the store elements of the default-language page are Arabic, right to left, in the export; under /en they are English', async () => {
  const root = await fs.readFile(path.join(out, 'index.html'), 'utf8');
  for (const name of ['productGrid', 'cartIndicator']) {
    expect(root, name).toMatch(new RegExp(`<div [^>]*data-ws-store="${name}"[^>]*dir="rtl" lang="ar"`));
  }
  expect(root).toContain('جارٍ تحميل المنتجات…');
  expect(root).toContain('aria-label="السلة فارغة"');
  expect(root).not.toContain('Loading products…');

  const english = await fs.readFile(path.join(out, 'en', 'index.html'), 'utf8');
  expect(english).toMatch(/<div [^>]*data-ws-store="productGrid"[^>]*dir="ltr" lang="en"/);
  expect(english).toContain('Loading products…');
  expect(english).not.toContain('جارٍ تحميل المنتجات…');
});

test('no file of the export names Google\'s font hosts, and the site\'s font files are in the export, named relative to each page', async () => {
  const files = await walk(out);
  for (const file of files.filter((name) => /\.(html|css|js|json|txt|xml)$/.test(name))) {
    const content = await fs.readFile(path.join(out, file), 'utf8');
    expect(content, file).not.toMatch(/fonts\.gstatic\.com|fonts\.googleapis\.com/);
    expect(content, file).not.toMatch(/\/(?:ycode|studio)\/api\/fonts/);
  }

  const root = await fs.readFile(path.join(out, 'index.html'), 'utf8');
  const rules = /<style[^>]*>((?:(?!<\/style>)[\s\S])*@font-face(?:(?!<\/style>)[\s\S])*)<\/style>/.exec(root)?.[1];
  test.skip(!rules, 'the mirror could not read the family from Google in this run (no network): the export carries no font');

  // The root's rules reach the files with `./`, a page under /en with `../`, and every file they name is in the export.
  const named = Array.from(rules!.matchAll(/url\(([^)]+)\)/g), (match) => match[1]);
  expect(named.length).toBeGreaterThan(0);
  for (const url of named) {
    expect(url.startsWith('./studio/fonts/ibmplexsansarabic/'), url).toBe(true);
    expect(files, url).toContain(url.slice(2));
  }
  const english = await fs.readFile(path.join(out, 'en', 'index.html'), 'utf8');
  const englishUrls = Array.from(english.matchAll(/@font-face[^}]*url\(([^)]+)\)/g), (match) => match[1]);
  expect(englishUrls.length).toBeGreaterThan(0);
  for (const url of englishUrls) expect(url.startsWith('../studio/fonts/ibmplexsansarabic/'), url).toBe(true);

  // The heading's file is preloaded from the same place, and what the export wrote is a font.
  const preload = /<link rel="preload" as="font" href="([^"]+)"/.exec(root)?.[1];
  expect(preload, 'the font file of the first heading is preloaded').toBeTruthy();
  expect(named).toContain(preload);
  const bytes = await fs.readFile(path.join(out, named[0].slice(2)));
  expect(bytes.subarray(0, 4).toString('latin1')).toBe('wOF2');
});
