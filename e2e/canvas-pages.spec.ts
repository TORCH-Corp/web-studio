/**
 * The builder's canvas across pages (owner, 18 Nov 2026).
 *
 * The canvas was rebuilt for every page: a switch threw the frame away and loaded Tailwind, the scripts, the fonts
 * and the images again, and going back to a page did the same. One frame now serves every page. This spec checks
 * what that must keep true: the frame is the same one after a switch and after going back, each page shows its own
 * layers and none of the other's, and a page opens at its top whatever the last page was scrolled to.
 */

import { expect, test, type APIRequestContext, type Frame, type Page } from '@playwright/test';
import { createSite, draftPages, openSite, signIn, type SiteRecord } from './helpers';

test.describe.configure({ mode: 'serial' });

const RUN = Date.now().toString(36);
const ORG = '5a5a5a5a-5a5a-4a5a-8a5a-5a5a5a5a5a5a';
const USER = { sub: '5b5b5b5b-5b5b-4b5b-8b5b-5b5b5b5b5b5b', email: 'owner-canvas-pages@example.com', name: 'Owner Canvas', org: ORG };

const FIRST = 'First page heading';
const SECOND = 'Second page heading';
const SECOND_NAME = `Second ${RUN}`;

const text = (value: string) => ({ type: 'dynamic_rich_text', data: { content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: value }] }] } } });
/** A heading and a block tall enough that the canvas scrolls. */
const layers = (heading: string, id: string) => [{
  id: 'body',
  name: 'body',
  classes: '',
  children: [
    { id: `${id}-heading`, name: 'heading', settings: { tag: 'h1' }, classes: '', children: [], variables: { text: text(heading) } },
    { id: `${id}-tall`, name: 'div', classes: 'h-[4000px]', children: [] },
    { id: `${id}-end`, name: 'text', settings: { tag: 'p' }, classes: '', children: [], variables: { text: text(`${heading} end`) } },
  ],
}];

let baseURL: string;
let api: APIRequestContext;
let site: SiteRecord;

test.beforeAll(async ({ baseURL: configured }) => {
  baseURL = configured!;
  api = await signIn(baseURL, USER);
  site = await createSite(api, { name: 'Canvas pages', slug: `canvas-pages-${RUN}`, languages: ['en'], default_language: 'en' });
  expect((await openSite(api, site.id)).status()).toBe(303);

  const home = (await draftPages(api)).find((page) => page.is_index)!.id;
  const created = await api.post('/ycode/api/pages', { data: { name: SECOND_NAME, slug: `second-${RUN}`, settings: {} } });
  expect(created.ok(), await created.text()).toBe(true);
  const second = (await created.json()).data.id as string;
  for (const [pageId, heading, id] of [[home, FIRST, 'first'], [second, SECOND, 'second']] as const) {
    const saved = await api.put(`/ycode/api/layers?page_id=${pageId}`, { data: { layers: layers(heading, id) } });
    expect(saved.status(), await saved.text()).toBe(200);
  }
});

test.afterAll(async () => {
  if (site?.id) await api?.delete(`/ycode/api/platform/sites/${site.id}`);
  await api?.dispose();
});

const canvasOf = (page: Page) => page.frameLocator('iframe[title="Canvas Editor"]');
const frameWindow = (page: Page) => page.locator('iframe[title="Canvas Editor"]');

test('one canvas frame serves every page: it survives a switch and the way back, and each page opens at its top with its own layers', async ({ browser }) => {
  const context = await browser.newContext({ baseURL, storageState: await api.storageState(), viewport: { width: 1600, height: 1000 } });
  const page = await context.newPage();
  try {
    await page.goto(`/ycode/api/platform/sites/${site.id}/open`);
    const canvas = canvasOf(page);
    await expect(canvas.locator('h1')).toHaveText(FIRST, { timeout: 60_000 });

    // A mark on the frame's own window: a rebuilt frame has a new window and no mark.
    await frameWindow(page).evaluate((frame: HTMLIFrameElement) => { (frame.contentWindow as unknown as { keptFrame?: boolean }).keptFrame = true; });
    const kept = () => frameWindow(page).evaluate((frame: HTMLIFrameElement) => (frame.contentWindow as unknown as { keptFrame?: boolean }).keptFrame === true);
    const scrollTop = () => frameWindow(page).evaluate((frame: HTMLIFrameElement) => frame.contentDocument!.scrollingElement!.scrollTop);

    // Scroll the first page down, so the next page would open scrolled if the frame kept its place.
    await frameWindow(page).evaluate((frame: HTMLIFrameElement) => frame.contentDocument!.scrollingElement!.scrollTo(0, 1500));
    await expect.poll(scrollTop).toBeGreaterThan(1000);

    await page.getByRole('tab', { name: 'Pages' }).first().click();
    await page.getByText(SECOND_NAME, { exact: true }).first().click();
    await expect(canvas.locator('h1')).toHaveText(SECOND);
    await expect(canvas.getByText(FIRST, { exact: true })).toHaveCount(0);
    expect(await kept()).toBe(true);
    await expect.poll(scrollTop).toBe(0);

    // The way back: the same frame again, the first page's layers and only those.
    await page.getByText('Homepage', { exact: true }).first().click();
    await expect(canvas.locator('h1')).toHaveText(FIRST);
    await expect(canvas.getByText(SECOND, { exact: true })).toHaveCount(0);
    await expect(canvas.locator('[data-layer-id="first-tall"]')).toHaveCount(1);
    expect(await kept()).toBe(true);
  } finally {
    await context.close();
  }
});

test('the canvas loads its scripts once: Tailwind, GSAP and SplitText are asked for once at open and not again on a switch', async ({ browser }) => {
  const context = await browser.newContext({ baseURL, storageState: await api.storageState(), viewport: { width: 1600, height: 1000 } });
  const page = await context.newPage();
  // Every /vendor request with the frame that made it: the builder has other, hidden frames with Tailwind of their own
  // (the thumbnail and the CSS generator), and this is about the canvas.
  const requests: Array<{ path: string; frame: Frame }> = [];
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith('/vendor/')) requests.push({ path, frame: request.frame() });
  });
  const askedByCanvas = async (): Promise<string[]> => {
    const paths: string[] = [];
    for (const { path, frame } of requests) {
      if (frame === page.mainFrame() || frame.isDetached()) continue;
      const title = await (await frame.frameElement()).getAttribute('title');
      if (title === 'Canvas Editor') paths.push(path);
    }
    return paths.sort();
  };
  try {
    await page.goto(`/ycode/api/platform/sites/${site.id}/open`);
    const canvas = canvasOf(page);
    await expect(canvas.locator('h1')).toHaveText(FIRST, { timeout: 60_000 });
    const SCRIPTS = ['/vendor/SplitText.min.js', '/vendor/gsap.min.js', '/vendor/tailwindcss-browser.js'];
    expect(await askedByCanvas()).toEqual(SCRIPTS);
    // GSAP and its plugin are there for the canvas's animations.
    expect(await frameWindow(page).evaluate((frame: HTMLIFrameElement) => {
      const win = frame.contentWindow as unknown as { gsap?: unknown; SplitText?: unknown };
      return typeof win.gsap !== 'undefined' && typeof win.SplitText !== 'undefined';
    })).toBe(true);

    await page.getByRole('tab', { name: 'Pages' }).first().click();
    await page.getByText(SECOND_NAME, { exact: true }).first().click();
    await expect(canvas.locator('h1')).toHaveText(SECOND);
    expect(await askedByCanvas()).toEqual(SCRIPTS);

    // The canvas's own files are sent to be kept, not asked for again each time.
    const header = (await context.request.get('/vendor/tailwindcss-browser.js')).headers()['cache-control'];
    expect(header).toContain('max-age=86400');
  } finally {
    await context.close();
  }
});
