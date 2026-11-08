/**
 * Part 2, session 13: Arabic tanween in the builder canvas (part 1 RELEASE.md, bug 5).
 *
 * WebKitGTK draws a word that ends in an Arabic mark above the line, in the canvas
 * and on a published page alike (lib/platform/arabic-marks.ts has the cause). The
 * canvas, and only the canvas, puts a combining grapheme joiner after the marks when
 * the engine is WebKit on Linux. This spec checks what a browser can: that the
 * joiner is in the canvas text for that engine and for no other, and that it never
 * reaches the layer data or the published page. That the word then sits on the line
 * can only be seen in WebKitGTK itself (screenshots/W7).
 */

import { expect, test, type APIRequestContext, type BrowserContext, type Page } from '@playwright/test';
import { createSite, draftPages, openSite, publish, publishedSite, signIn, TEST_SITES_DOMAIN, type SiteRecord } from './helpers';

test.describe.configure({ mode: 'serial' });

const RUN = Date.now().toString(36);
const ORG = '3a3a3a3a-3a3a-4a3a-8a3a-3a3a3a3a3a3a';
const USER = { sub: '3b3b3b3b-3b3b-4b3b-8b3b-3b3b3b3b3b3b', email: 'owner-m@example.com', name: 'Owner M', org: ORG };
const SLUG = `marks-${RUN}`;
const HOST = `${SLUG}.${TEST_SITES_DOMAIN}`;
const JOINER = '\u034f';
const WEBKIT_GTK = 'Mozilla/5.0 (X11; Ubuntu; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/60.5 Safari/605.1.15';

const HEADING = 'مرحباً بكم، وفريقاً';
const BOLD = 'قصيراً';
const PLAIN_FOLLOWING = ' ونص'; // no mark: it must come out as it went in

const doc = (...content: unknown[]) => ({ type: 'doc', content: [{ type: 'paragraph', content }] });
const rich = (id: string, name: string, tag: string, content: unknown) => ({
  id,
  name,
  settings: { tag },
  classes: '',
  children: [],
  variables: { text: { type: 'dynamic_rich_text', data: { content } } },
});

let baseURL: string;
let site: SiteRecord;
let pageId: string;
let storageState: Awaited<ReturnType<APIRequestContext['storageState']>>;

test.beforeAll(async ({ baseURL: configured }) => {
  baseURL = configured!;
  const api = await signIn(baseURL, USER);
  site = await createSite(api, { name: 'Marks', slug: SLUG, languages: ['ar'], default_language: 'ar' });
  expect((await openSite(api, site.id)).status()).toBe(303);

  pageId = (await draftPages(api)).find((page) => page.is_index)!.id;
  const response = await api.put(`/ycode/api/layers?page_id=${pageId}`, {
    data: {
      layers: [{
        id: 'body',
        name: 'body',
        classes: '',
        children: [
          rich('title', 'heading', 'h1', doc({ type: 'text', text: HEADING })),
          rich('lead', 'text', 'p', doc({ type: 'text', text: BOLD, marks: [{ type: 'bold' }] }, { type: 'text', text: PLAIN_FOLLOWING })),
        ],
      }],
    },
  });
  expect(response.status(), await response.text()).toBe(200);
  await publish(api);
  storageState = await api.storageState();
  await api.dispose();
});

/** The canvas's text of the heading and of the paragraph, read from the builder iframe. */
async function canvasText(context: BrowserContext): Promise<{ heading: string; lead: string; bold: string }> {
  const page: Page = await context.newPage();
  try {
    await page.goto(`/ycode/api/platform/sites/${site.id}/open`);
    const canvas = page.frameLocator('iframe').first();
    await expect(canvas.locator('h1')).toBeVisible({ timeout: 60_000 });
    return {
      heading: (await canvas.locator('h1').first().textContent()) ?? '',
      lead: (await canvas.locator('p').first().textContent()) ?? '',
      bold: (await canvas.locator('p strong').first().textContent()) ?? '',
    };
  } finally {
    await page.close();
  }
}

test('in WebKitGTK the canvas puts a joiner after each tanween, inside bold text too', async ({ browser }) => {
  const context = await browser.newContext({ baseURL, storageState, userAgent: WEBKIT_GTK, viewport: { width: 1600, height: 1000 } });
  try {
    const text = await canvasText(context);
    expect(text.heading).toBe('مرحباً' + JOINER + ' بكم، وفريقاً' + JOINER);
    expect(text.bold).toBe(BOLD + JOINER);
    expect(text.lead).toBe(BOLD + JOINER + PLAIN_FOLLOWING);
  } finally {
    await context.close();
  }
});

test('in any other engine the canvas text is exactly the layer text', async ({ browser }) => {
  const context = await browser.newContext({ baseURL, storageState, viewport: { width: 1600, height: 1000 } });
  try {
    const text = await canvasText(context);
    expect(text.heading).toBe(HEADING);
    expect(text.lead).toBe(BOLD + PLAIN_FOLLOWING);
    expect(`${text.heading}${text.lead}`).not.toContain(JOINER);
  } finally {
    await context.close();
  }
});

test('the layer data and the published page never carry the joiner', async () => {
  const api = await signIn(baseURL, USER);
  try {
    expect((await openSite(api, site.id)).status()).toBe(303);
    const layers = await api.get(`/ycode/api/layers?page_id=${pageId}`);
    expect(layers.status()).toBe(200);
    const stored = await layers.text();
    expect(stored).toContain(HEADING);
    expect(stored).not.toContain(JOINER);
  } finally {
    await api.dispose();
  }

  // The server sends every engine the same page: a joiner in it could only come from the renderer the published page uses.
  const published = await publishedSite(baseURL, HOST);
  try {
    const response = await published.get('/');
    expect(response.status()).toBe(200);
    const html = await response.text();
    expect(html).toContain(HEADING);
    expect(html).not.toContain(JOINER);
  } finally {
    await published.dispose();
  }
});
