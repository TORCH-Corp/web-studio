/**
 * A part 1 contact form on a published page (part 2 release fixes, OPEN_QUESTIONS
 * 52). ycode renders a decoy field in every published form; it sat at
 * `left: -9999px`, and on an Arabic page (`<html dir="rtl">`, where the
 * scrollable overflow runs to the left) that made the page 9,999 px too wide.
 * The decoy is off the side the page starts on now: no sideways scroll in either
 * direction, and the decoy is still in the form for a bot to fill.
 */

import { chromium, expect, test, type APIRequestContext, type Browser } from '@playwright/test';
import { createSite, draftPages, openSite, publish, signIn, TEST_SITES_DOMAIN, type SiteRecord } from './helpers';
import { HONEYPOT_FIELD_NAME } from '../lib/form-spam-settings';

test.describe.configure({ mode: 'serial' });

const RUN = Date.now().toString(36);
const PORT = Number(process.env.E2E_PORT || 3102);
const ORG = '3c3c3c3c-3c3c-4c3c-8c3c-3c3c3c3c3c3c';
const USER = { sub: '3d3d3d3d-3d3d-4d3d-8d3d-3d3d3d3d3d3d', email: 'owner-form-rtl@example.com', name: 'Owner Form RTL', org: ORG };
const SLUG = `formrtl-${RUN}`;
const ORIGIN = `http://${SLUG}.${TEST_SITES_DOMAIN}:${PORT}`;

let baseURL: string;
let api: APIRequestContext;
let browser: Browser;
let site: SiteRecord;

const richText = (text: string) => ({
  text: { type: 'dynamic_rich_text', data: { content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] } } },
});

/** A page with a heading and a standard contact form (the form layer of ycode's own template, with one line of text in it). */
const LAYERS = [
  {
    id: 'body',
    name: 'body',
    classes: '',
    children: [
      { id: 'title', name: 'heading', settings: { tag: 'h1' }, classes: '', children: [], variables: richText('اتصل بنا') },
      {
        id: 'contact-form-layer',
        name: 'form',
        classes: 'flex flex-col gap-8 w-full',
        settings: { id: 'contact-form', form: { form_type: 'standard', success_action: 'message' } },
        children: [{ id: 'hint', name: 'text', settings: { tag: 'p' }, classes: '', children: [], variables: richText('اكتب رسالتك') }],
      },
    ],
  },
];

test.beforeAll(async ({ baseURL: configured }) => {
  baseURL = configured!;
  api = await signIn(baseURL, USER);
  site = await createSite(api, { name: 'نموذج', slug: SLUG, languages: ['ar', 'en'], default_language: 'ar' });
  expect((await openSite(api, site.id)).status()).toBe(303);
  const home = (await draftPages(api)).find((page) => page.is_index);
  expect(home).toBeTruthy();
  const saved = await api.put(`/ycode/api/layers?page_id=${home!.id}`, { data: { layers: LAYERS } });
  expect(saved.status(), await saved.text()).toBe(200);
  await publish(api);
  browser = await chromium.launch({ args: [`--host-resolver-rules=MAP *.${TEST_SITES_DOMAIN} 127.0.0.1`] });
});

test.afterAll(async () => {
  await browser?.close();
  if (site) await api.delete(`/ycode/api/platform/sites/${site.id}`);
  await api?.dispose();
});

for (const { path, dir, name } of [
  { path: '/', dir: 'rtl', name: 'an Arabic page' },
  { path: '/en', dir: 'ltr', name: 'an English page' },
]) {
  for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
    test(`${name} with a contact form has no sideways scroll at ${viewport.width} px, and the decoy is in the form`, async () => {
      const context = await browser.newContext({ baseURL: ORIGIN, viewport });
      try {
        const page = await context.newPage();
        const response = await page.goto(path);
        expect(response?.status()).toBe(200);
        await expect(page.locator('html')).toHaveAttribute('dir', dir);
        const form = page.locator('form#contact-form');
        await expect(form).toHaveCount(1);

        // The bot's side: the decoy is in the form, named as the route reads it, and not display none.
        const decoy = form.locator(`input[name="${HONEYPOT_FIELD_NAME}"]`);
        await expect(decoy).toHaveCount(1);
        await expect(decoy).toHaveAttribute('tabindex', '-1');
        expect(await decoy.evaluate((input) => getComputedStyle(input.closest('[aria-hidden="true"]')!).display)).not.toBe('none');

        // The person's side: nothing to scroll to, and the decoy is not in the window.
        const widths = await page.evaluate(() => ({
          scroll: document.documentElement.scrollWidth,
          client: document.documentElement.clientWidth,
          body: document.body.scrollWidth,
        }));
        expect(widths.scroll, JSON.stringify(widths)).toBeLessThanOrEqual(widths.client);
        expect(widths.body, JSON.stringify(widths)).toBeLessThanOrEqual(widths.client);
        const box = await decoy.evaluate((input) => {
          const rect = input.closest('[aria-hidden="true"]')!.getBoundingClientRect();
          return { left: rect.left, right: rect.right };
        });
        expect(box.right < 0 || box.left > viewport.width, JSON.stringify(box)).toBe(true);
      } finally {
        await context.close();
      }
    });
  }
}
