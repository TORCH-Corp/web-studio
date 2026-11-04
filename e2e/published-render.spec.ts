/**
 * What a published page carries (found on the Task B template fixtures, 3 Nov 2026,
 * OPEN_QUESTIONS 25 to 27):
 *
 * - the body layer's classes on `<body>` (a site's font and base colours);
 * - an image layer bound to an uploaded asset served from that asset, not ycode's
 *   placeholder;
 * - a site's own 404 page with its own styles.
 */

import { expect, test, type APIRequestContext } from '@playwright/test';
import { createSite, draftPages, openSite, publish, publishedSite, signIn, TEST_SITES_DOMAIN, type SiteRecord } from './helpers';

test.describe.configure({ mode: 'serial' });

const RUN = Date.now().toString(36);
const ORG = '2a2a2a2a-2a2a-4a2a-8a2a-2a2a2a2a2a2a';
const USER = { sub: '2b2b2b2b-2b2b-4b2b-8b2b-2b2b2b2b2b2b', email: 'owner-r@example.com', name: 'Owner R', org: ORG };
const SLUG = `render-${RUN}`;
const HOST = `${SLUG}.${TEST_SITES_DOMAIN}`;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

let baseURL: string;
let api: APIRequestContext;
let site: SiteRecord;

function heading(id: string, text: string, classes: string) {
  return {
    id,
    name: 'heading',
    settings: { tag: 'h1' },
    classes,
    children: [],
    variables: {
      text: { type: 'dynamic_rich_text', data: { content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] } } },
    },
  };
}

async function putLayers(pageId: string, layers: unknown[]): Promise<void> {
  const response = await api.put(`/ycode/api/layers?page_id=${pageId}`, { data: { layers } });
  expect(response.status(), await response.text()).toBe(200);
}

async function visit(path: string) {
  const anonymous = await publishedSite(baseURL, HOST);
  try {
    const response = await anonymous.get(path);
    return { status: response.status(), html: await response.text() };
  } finally {
    await anonymous.dispose();
  }
}

test.beforeAll(async ({ baseURL: configured }) => {
  baseURL = configured!;
  api = await signIn(baseURL, USER);
  site = await createSite(api, { name: 'Rendered', slug: SLUG, languages: ['en'], default_language: 'en' });
  expect((await openSite(api, site.id)).status()).toBe(303);

  const upload = await api.post('/ycode/api/assets/upload', {
    multipart: { source: 'library', file: { name: 'hero.png', mimeType: 'image/png', buffer: PNG } },
  });
  expect(upload.status(), await upload.text()).toBe(200);
  const assetId = (await upload.json()).data.id as string;

  const pages = await draftPages(api);
  const home = pages.find((page) => page.is_index)!;
  const notFound = pages.find((page) => page.error_page === 404)!;
  await putLayers(home.id, [{
    id: 'body',
    name: 'body',
    classes: 'bg-[#123456] text-[#abcdef]',
    children: [
      heading('home-title', 'Rendered home', 'text-[31px]'),
      {
        id: 'hero-image',
        name: 'image',
        classes: 'w-[64px]',
        children: [],
        variables: { image: { src: { type: 'asset', data: { asset_id: assetId } }, alt: { type: 'dynamic_text', data: { content: 'Hero' } } } },
      },
    ],
  }]);
  await putLayers(notFound.id, [{ id: 'body', name: 'body', classes: 'bg-[#654321]', children: [heading('lost-title', 'Lost here', 'text-[29px]')] }]);
  await publish(api);
});

test.afterAll(async () => {
  if (site) await api.delete(`/ycode/api/platform/sites/${site.id}`);
  await api?.dispose();
});

test('the body layer\'s classes are on the published <body>', async () => {
  const { status, html } = await visit('/');
  expect(status).toBe(200);
  expect(html).toContain('Rendered home');
  const body = html.match(/<body[^>]*class="([^"]*)"/)?.[1] ?? '';
  expect(body).toContain('bg-[#123456]');
  expect(body).toContain('text-[#abcdef]');
});

test('an image bound to an uploaded asset is served from that asset, not the placeholder', async () => {
  const { html } = await visit('/');
  const img = html.match(/<img[^>]*data-layer-id="hero-image"[^>]*>/)?.[0];
  expect(img, 'the image layer is rendered').toBeTruthy();
  const src = img!.match(/\ssrc="([^"]+)"/)?.[1] ?? '';
  expect(src.startsWith('data:'), `src is ycode's placeholder: ${src.slice(0, 60)}`).toBe(false);
  const file = await (await publishedSite(baseURL, HOST)).get(src.replace(/&amp;/g, '&'));
  expect(file.status()).toBe(200);
  expect(file.headers()['content-type']).toMatch(/^image\//);
});

test('a site\'s own 404 page is published with its own styles', async ({ browser }) => {
  // The 404 boundary's content streams in after the shell, so this is checked in a browser:
  // the heading carries the 404 page's own class, and that class's CSS must apply.
  const context = await browser.newContext({ baseURL, extraHTTPHeaders: { 'x-forwarded-host': HOST } });
  try {
    const page = await context.newPage();
    const response = await page.goto(`/no-such-page-${RUN}`);
    expect(response?.status()).toBe(404);
    const title = page.getByText('Lost here');
    await expect(title).toBeVisible();
    expect(await title.evaluate((el) => getComputedStyle(el.closest('h1') ?? el).fontSize)).toBe('29px');
  } finally {
    await context.close();
  }
});
