/**
 * Part 3, session W2 "done when": Forms on the port, for every site and with no flag.
 *
 * A user adds a form in the builder (the Form element is in the library, its settings have no email block), the
 * site publishes in Arabic and English, and a visitor submits it on the site's own host: the labels, the success
 * message and the error message are in the page's language and direction. The row lands in `form_submissions`
 * for that site only; another site's list does not hold it. The honeypot still files a bot's post as spam, a post from
 * another origin is refused, and the rate limit refuses the visitor with the error message in the page's language.
 * ycode's webhook is not dispatched any more (the submit route does one thing: store).
 */

import http from 'node:http';
import knex, { type Knex } from 'knex';
import { chromium, expect, request, test, type APIRequestContext, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { createSite, draftPages, openSite, publish, signIn, TEST_SITES_DOMAIN, type SiteRecord } from './helpers';
import { HONEYPOT_FIELD_NAME } from '../lib/form-spam-settings';

test.describe.configure({ mode: 'serial' });

const RUN = Date.now().toString(36);
const PORT = Number(process.env.E2E_PORT || 3102);
const HOOK_PORT = PORT + 5;
const ORG = '6a6a6a6a-6a6a-4a6a-8a6a-6a6a6a6a6a6a';
const USER = { sub: '6b6b6b6b-6b6b-4b6b-8b6b-6b6b6b6b6b6b', email: 'owner-forms@example.com', name: 'Owner Forms', org: ORG };

/** What ycode's Form element says, and what the page says in Arabic. */
const TEXTS: Array<[english: string, arabic: string]> = [
  ['Something went wrong! Try submitting form once again.', 'حدث خطأ ما! حاول إرسال النموذج مرة أخرى.'],
  ['Successfully submitted.', 'تم الإرسال بنجاح.'],
  ['Full name', 'الاسم الكامل'],
  ['Email', 'البريد الإلكتروني'],
  ['Message', 'الرسالة'],
  ['Submit', 'إرسال'],
];
const ERROR_AR = TEXTS[0][1];
const SUCCESS_AR = TEXTS[1][1];
const SUCCESS_EN = TEXTS[1][0];

interface Layer {
  id: string;
  name: string;
  children?: Layer[];
  variables?: { text?: { data?: { content?: { content?: Array<{ content?: Array<{ text?: string }> }> } } } };
}

let baseURL: string;
let ownerA: APIRequestContext;
let ownerB: APIRequestContext;
let siteA: SiteRecord;
let siteB: SiteRecord;
let browser: Browser;
let db: Knex;
let hook: http.Server;
const hookHits: string[] = [];
let storageA: Awaited<ReturnType<APIRequestContext['storageState']>>;

const origin = (site: SiteRecord) => `http://${site.slug}.${TEST_SITES_DOMAIN}:${PORT}`;
const textOf = (layer: Layer) => layer.variables?.text?.data?.content?.content?.[0]?.content?.[0]?.text;

function walk(layers: Layer[], visit: (layer: Layer) => void): void {
  for (const layer of layers) {
    visit(layer);
    walk(layer.children ?? [], visit);
  }
}

async function homeOf(api: APIRequestContext): Promise<{ id: string; layers: Layer[] }> {
  const home = (await draftPages(api)).find((page) => page.is_index)!;
  const response = await api.get(`/ycode/api/layers?page_id=${home.id}`);
  expect(response.status(), await response.text()).toBe(200);
  return { id: home.id, layers: (await response.json()).data.layers as Layer[] };
}

/** The Arabic text for every translatable text of a home page, in the site's Arabic locale, marked complete so the live page uses it. */
async function translateToArabic(api: APIRequestContext, pageId: string, layers: Layer[]): Promise<void> {
  const locales = (await (await api.get('/ycode/api/locales')).json()).data as Array<{ id: string; code: string }>;
  const arabic = locales.find((locale) => locale.code === 'ar')!;
  const done: string[] = [];
  walk(layers, (layer) => {
    const english = textOf(layer);
    const row = TEXTS.find(([source]) => source === english);
    if (row && layer.name === 'text') done.push(`${layer.id}|${row[1]}`);
  });
  expect(done.length, 'the form has six texts to translate').toBe(TEXTS.length);
  for (const entry of done) {
    const [layerId, value] = entry.split('|');
    const response = await api.post('/ycode/api/translations', {
      data: { locale_id: arabic.id, source_type: 'page', source_id: pageId, content_key: `layer:${layerId}:text`, content_type: 'text', content_value: value, is_completed: true },
    });
    expect(response.status(), await response.text()).toBe(201);
  }
}

async function spamSetting(api: APIRequestContext, rateLimitMaxSubmissions: number): Promise<void> {
  const response = await api.put('/ycode/api/settings/form_spam_protection', {
    data: { value: { enabled: true, rateLimitEnabled: true, rateLimitMaxSubmissions, allowExternalSubmissions: false } },
  });
  expect(response.status(), await response.text()).toBe(200);
}

/** A visitor with a browser on the site's own host. */
async function visit(site: SiteRecord, path: string): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ baseURL: origin(site) });
  const page = await context.newPage();
  const response = await page.goto(path);
  expect(response?.status(), `${site.slug}${path}`).toBe(200);
  return { context, page };
}

async function fillAndSubmit(page: Page, who: string): Promise<void> {
  const form = page.locator('form#contact-form');
  await form.locator('[name="name"]').fill(who);
  await form.locator('[name="email"]').fill(`${who.replace(/\s/g, '.').toLowerCase()}@example.com`);
  await form.locator('[name="message"]').fill(`مرحبا من ${who} / hello from ${who}`);
  await form.getByRole('button').last().click();
}

/** A visitor's own request to a site's submit route (what a script or a bot sends). */
function visitorApi(site: SiteRecord, ip: string, extra: Record<string, string> = {}): Promise<APIRequestContext> {
  const host = site.hosts[0];
  return request.newContext({ baseURL, extraHTTPHeaders: { 'x-forwarded-host': host, origin: `http://${host}`, 'x-forwarded-for': ip, ...extra } });
}

const rowsOf = (site: SiteRecord) => db('form_submissions').where({ tenant_id: site.id }).orderBy('created_at', 'asc');
const idsOf = async (api: APIRequestContext, query = '') => ((await (await api.get(`/ycode/api/form-submissions${query}`)).json()).data as Array<{ id: string }>).map((row) => row.id).sort();

test.beforeAll(async ({ baseURL: configured }) => {
  baseURL = configured!;
  db = knex({ client: 'pg', connection: process.env.DATABASE_URL_TEST });
  // A listener standing in for a webhook endpoint: ycode used to post every submission to it.
  hook = http.createServer((req, res) => { hookHits.push(`${req.method} ${req.url}`); res.end('ok'); });
  await new Promise<void>((resolve) => hook.listen(HOOK_PORT, '127.0.0.1', resolve));

  ownerA = await signIn(baseURL, USER);
  ownerB = await signIn(baseURL, USER);
  siteA = await createSite(ownerA, { name: 'Forms A', slug: `forms-a-${RUN}`, languages: ['en', 'ar'], default_language: 'en' });
  siteB = await createSite(ownerB, { name: 'Forms B', slug: `forms-b-${RUN}`, languages: ['en', 'ar'], default_language: 'en' });
  expect((await openSite(ownerA, siteA.id)).status()).toBe(303);
  expect((await openSite(ownerB, siteB.id)).status()).toBe(303);
  storageA = await ownerA.storageState();

  // A webhook on site A that listens for form submissions: the route must not call it.
  await db.transaction(async (trx) => {
    await trx.raw('SELECT set_tenant_context(?::uuid)', [siteA.id]);
    await trx('webhooks').insert({ name: 'forms e2e', url: `http://127.0.0.1:${HOOK_PORT}/hook`, events: JSON.stringify(['form.submitted']), enabled: true });
  });
  browser = await chromium.launch({ args: [`--host-resolver-rules=MAP *.${TEST_SITES_DOMAIN} 127.0.0.1`] });
});

test.afterAll(async () => {
  await browser?.close();
  await new Promise<void>((resolve) => (hook ? hook.close(() => resolve()) : resolve()));
  for (const [owner, site] of [[ownerA, siteA], [ownerB, siteB]] as const) {
    if (site) await owner.delete(`/ycode/api/platform/sites/${site.id}`);
    await owner?.dispose();
  }
  await db?.destroy();
});

test('the builder shows the Form element and the Forms screen, and a form\'s settings have no email block', async ({ browser: builderBrowser }) => {
  const context = await builderBrowser.newContext({ baseURL, storageState: storageA, viewport: { width: 1600, height: 1000 } });
  try {
    const page = await context.newPage();
    await page.goto(`/ycode/api/platform/sites/${siteA.id}/open`);
    await expect(page.getByRole('button', { name: 'Design', exact: true })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole('button', { name: 'CMS', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Forms', exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Add layout' }).click();
    await page.getByRole('tab', { name: 'Elements' }).click();
    await page.getByRole('button', { name: 'Form', exact: true }).click();
    await expect(page.getByText('Saved', { exact: true })).toBeVisible({ timeout: 20_000 });

    await page.getByRole('tabpanel', { name: 'Layers' }).getByRole('button', { name: 'Form', exact: true }).click();
    await page.getByRole('tab', { name: 'Settings' }).click();
    await expect(page.getByText('Form Settings', { exact: true })).toBeVisible();
    await expect(page.getByText('Success', { exact: true })).toBeVisible();
    await expect(page.getByText('Email notification')).toHaveCount(0);
    await expect(page.getByText('Send to')).toHaveCount(0);

    // The screen the Forms button opens answers, with no submission yet.
    await page.getByRole('button', { name: 'Forms', exact: true }).click();
    await expect(page).toHaveURL(/\/ycode\/forms$/);
    await expect(page.getByText(/Application error|Something went wrong/i)).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test('the Forms button is drawn for a user who holds the forms flag, and not for one who does not', async ({ browser: builderBrowser }) => {
  // Both may change content (the role of a designer); only the second may read submissions. The API refuses the first either way.
  const withoutForms = { sub: '6c6c6c6c-6c6c-4c6c-8c6c-6c6c6c6c6c6c', email: 'designer-forms@example.com', name: 'Designer', org: ORG, perms: { 'webstudio.manage_sites': ['r'], 'webstudio.manage_content': ['c', 'r', 'u'] } };
  const withForms = { ...withoutForms, sub: '6d6d6d6d-6d6d-4d6d-8d6d-6d6d6d6d6d6d', email: 'designer-forms-r@example.com', perms: { ...withoutForms.perms, 'webstudio.manage_forms': ['r'] } };
  for (const [user, forms] of [[withoutForms, 0], [withForms, 1]] as const) {
    const api = await signIn(baseURL, user);
    try {
      expect((await openSite(api, siteA.id)).status()).toBe(303);
      const context = await builderBrowser.newContext({ baseURL, storageState: await api.storageState(), viewport: { width: 1600, height: 1000 } });
      try {
        const page = await context.newPage();
        await page.goto(`/ycode/api/platform/sites/${siteA.id}/open`);
        await expect(page.getByRole('button', { name: 'Design', exact: true })).toBeVisible({ timeout: 60_000 });
        await expect(page.getByRole('button', { name: 'CMS', exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Forms', exact: true })).toHaveCount(forms);
      } finally {
        await context.close();
      }
      // The screen's data is the forms leaf's, whatever the button does.
      expect((await api.get('/ycode/api/form-submissions')).status()).toBe(forms ? 200 : 403);
    } finally {
      await api.dispose();
    }
  }
});

test('the form made in the builder is translated, copied to the second site, and both sites publish', async () => {
  const { id, layers } = await homeOf(ownerA);
  const form = layers[0].children?.find((layer) => layer.name === 'form');
  expect(form, 'the form the builder added').toBeTruthy();
  await translateToArabic(ownerA, id, layers);

  // The second site gets the same form (its own copy of the layers, its own locale rows).
  const homeB = await homeOf(ownerB);
  const saved = await ownerB.put(`/ycode/api/layers?page_id=${homeB.id}`, { data: { layers } });
  expect(saved.status(), await saved.text()).toBe(200);
  await translateToArabic(ownerB, homeB.id, layers);
  await spamSetting(ownerB, 2);

  await publish(ownerA);
  await publish(ownerB);
});

test('a visitor submits the form on an English page and on an Arabic page, each in its own language and direction', async () => {
  for (const { path, dir, lang, success, label } of [
    { path: '/', dir: 'ltr', lang: 'en', success: SUCCESS_EN, label: 'Full name' },
    { path: '/ar', dir: 'rtl', lang: 'ar', success: SUCCESS_AR, label: TEXTS[2][1] },
  ]) {
    const { context, page } = await visit(siteA, path);
    try {
      await expect(page.locator('html')).toHaveAttribute('dir', dir);
      await expect(page.locator('html')).toHaveAttribute('lang', lang);
      const form = page.locator('form#contact-form');
      await expect(form.getByText(label, { exact: true })).toBeVisible();
      await expect(form.getByRole('button').last()).toHaveText(path === '/' ? 'Submit' : TEXTS[5][1]);
      // Before the post both messages are out of sight.
      await expect(form.locator('[data-alert-type="success"]')).toBeHidden();
      await expect(form.locator('[data-alert-type="error"]')).toBeHidden();

      await fillAndSubmit(page, `Visitor ${lang}`);
      const ok = form.locator('[data-alert-type="success"]');
      await expect(ok).toBeVisible();
      await expect(ok).toHaveText(success);
      await expect(form.locator('[data-alert-type="error"]')).toBeHidden();
      expect(await ok.evaluate((el) => getComputedStyle(el).direction), 'the message is laid out in the page\'s direction').toBe(dir);
      // The form is cleared for the next one.
      await expect(form.locator('[name="name"]')).toHaveValue('');
    } finally {
      await context.close();
    }
  }

  const rows = await rowsOf(siteA);
  expect(rows.map((row) => row.status)).toEqual(['new', 'new']);
  expect(rows.map((row) => row.form_id)).toEqual(['contact-form', 'contact-form']);
  expect(rows[0].payload).toMatchObject({ name: 'Visitor en', email: 'visitor.en@example.com', message: 'مرحبا من Visitor en / hello from Visitor en' });
  expect(rows[1].payload).toMatchObject({ name: 'Visitor ar', email: 'visitor.ar@example.com' });
  expect(rows[1].metadata.page_url).toBe(`${origin(siteA)}/ar`);
  // The honeypot's field never reaches the row.
  for (const row of rows) expect(Object.keys(row.payload)).not.toContain(HONEYPOT_FIELD_NAME);
});

test('the other site holds none of it, and its own submissions stay its own', async () => {
  // Nothing was submitted on site B yet: its list is empty although site A has two rows.
  expect(await idsOf(ownerB)).toEqual([]);
  expect(await rowsOf(siteB)).toHaveLength(0);

  // Site B allows two submissions per visitor address. Its visitor sends one on each language, then is refused.
  const english = await visit(siteB, '/');
  try {
    await fillAndSubmit(english.page, 'Other en');
    await expect(english.page.locator('form#contact-form [data-alert-type="success"]')).toBeVisible();
  } finally {
    await english.context.close();
  }
  const arabic = await visit(siteB, '/ar');
  try {
    await fillAndSubmit(arabic.page, 'Other ar');
    const form = arabic.page.locator('form#contact-form');
    await expect(form.locator('[data-alert-type="success"]')).toBeVisible();
    await expect(form.locator('[data-alert-type="success"]')).toHaveText(SUCCESS_AR);

    // The third post is over the limit: the visitor is told in Arabic, on a right-to-left page, and no row is made.
    await fillAndSubmit(arabic.page, 'Other third');
    const failed = form.locator('[data-alert-type="error"]');
    await expect(failed).toBeVisible();
    await expect(failed).toHaveText(ERROR_AR);
    await expect(form.locator('[data-alert-type="success"]')).toBeHidden();
    await expect(arabic.page.locator('html')).toHaveAttribute('dir', 'rtl');
    expect(await failed.evaluate((el) => getComputedStyle(el).direction)).toBe('rtl');
    // What was typed stays for a retry.
    await expect(form.locator('[name="name"]')).toHaveValue('Other third');
  } finally {
    await arabic.context.close();
  }

  const mine = await rowsOf(siteB);
  expect(mine.map((row) => row.payload.name)).toEqual(['Other en', 'Other ar']);
  expect(await idsOf(ownerB)).toEqual(mine.map((row) => row.id).sort());
  const theirs = await rowsOf(siteA);
  expect(await idsOf(ownerA)).toEqual(theirs.map((row) => row.id).sort());
  expect(theirs).toHaveLength(2);
  // Each row is stamped with its own site and no other.
  const bySite = await db('form_submissions').select('tenant_id').count('* as n').whereIn('tenant_id', [siteA.id, siteB.id]).groupBy('tenant_id');
  expect(Object.fromEntries(bySite.map((row) => [row.tenant_id, Number(row.n)]))).toEqual({ [siteA.id]: 2, [siteB.id]: 2 });
  // The builder's own Forms list counts only the open site's forms.
  const summary = (await (await ownerB.get('/ycode/api/form-submissions?summary=true')).json()).data;
  expect(summary).toEqual([expect.objectContaining({ form_id: 'contact-form', submission_count: 2, new_count: 2 })]);
});

test('the honeypot files a bot\'s post as spam and a post from another origin is refused', async () => {
  const bot = await visitorApi(siteA, '10.1.1.1');
  const other = await visitorApi(siteA, '10.1.1.2', { origin: 'http://elsewhere.example' });
  try {
    const caught = await bot.post('/studio/api/form-submissions', { data: { form_id: 'contact-form', payload: { name: 'Bot', email: 'bot@example.com', message: 'buy now', [HONEYPOT_FIELD_NAME]: 'gotcha' } } });
    // The bot is told it worked, so it does not retry; the row is spam and never reaches the "new" list.
    expect(caught.status(), await caught.text()).toBe(201);
    const spam = await rowsOf(siteA).where({ status: 'spam' });
    expect(spam).toHaveLength(1);
    expect(spam[0].payload).toMatchObject({ name: 'Bot' });
    expect(Object.keys(spam[0].payload)).not.toContain(HONEYPOT_FIELD_NAME);
    expect((await rowsOf(siteA).where({ status: 'new' })).length).toBe(2);

    const refused = await other.post('/studio/api/form-submissions', { data: { form_id: 'contact-form', payload: { name: 'Elsewhere' } } });
    expect(refused.status(), await refused.text()).toBe(403);
    // A body with no form or no payload is a 400, and neither stores anything.
    expect((await bot.post('/studio/api/form-submissions', { data: { payload: {} } })).status()).toBe(400);
    expect((await bot.post('/studio/api/form-submissions', { data: { form_id: 'contact-form' } })).status()).toBe(400);
    expect(await rowsOf(siteA)).toHaveLength(3);
    // The site B's list still holds only its own two rows.
    expect(await rowsOf(siteB)).toHaveLength(2);
  } finally {
    await bot.dispose();
    await other.dispose();
  }
});

test('a submission calls no webhook: ycode\'s dispatch is gone from the submit route', async () => {
  // Five submissions went through site A, and a webhook for form.submitted was waiting on it. Give a late dispatch time to show.
  await new Promise((resolve) => setTimeout(resolve, 1500));
  expect(hookHits).toEqual([]);
  const deliveries = await db('webhook_deliveries').count('* as n').first();
  expect(Number(deliveries?.n)).toBe(0);
});
