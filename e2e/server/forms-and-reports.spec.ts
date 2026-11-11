/**
 * Part 3 on the deployed service (session D1, server mode): the contact form, the visit counting and the three
 * reports, against the real Contact Center, the real Notification Center and the real Organization Setup, no stub.
 *
 * A site of the test organization, with the builder's own Contact form element on its home page, is published on
 * https://{slug}.sites.torchcorp.com. A real browser (a Windows Chrome's user agent: the counting leaves a
 * program-driven browser out) opens it, which is one view, fills the form and sends it. Then, in order:
 *
 *   - the submission is in the app's Submissions API, unread, and its Contact Center state is `prospect`;
 *   - Contact Center holds that prospect (source WEB_FORM, the message in its notes), found through the user's token;
 *     the run then sets it aside and marks it (`markTestProspect`), so it can be found and cleaned;
 *   - the people who may read submissions are told: the test user's inbox holds the notification, with the deep link;
 *   - the Traffic, Conversions and summary routes answer with that one view and that one form;
 *   - every request the published page and the builder make stays on its own host, with no new exception.
 *
 * What it leaves: the test site, soft-deleted; one prospect in Contact Center, not interested and marked; the
 * notification it read; the visit rows of a site that no longer exists. Nothing in it needs a stub or a database.
 * Every run tells the organization's holders of `webstudio.manage_forms` r once, as a real submission does.
 */

import { chromium, expect, request, test, type APIRequestContext, type APIResponse, type Browser } from '@playwright/test';
import { createSite, draftPages, openSite, publish, signInWithToken, type SiteRecord } from '../helpers';
import { accessToken, CONTACT_CENTER_URL, deleteSite, EDGE_INJECTED, markTestProspect, NOTIFICATIONS_URL, SITES_DOMAIN, TEST_PROSPECT, watchHosts } from './real-services';

test.describe.configure({ mode: 'serial' });

const RUN = Date.now().toString(36);
const MESSAGE = `Web Studio server e2e ${RUN}: please ignore`;
/** A visitor's browser, as the counting wants one: the headless default says HeadlessChrome and is left out as a bot. */
const WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

interface Layer {
  id: string;
  name: string;
  settings?: { id?: string; form?: { create_prospect?: boolean } };
  attributes?: Record<string, unknown>;
  children?: Layer[];
}

let baseURL: string;
let builderHost: string;
let token: string;
let api: APIRequestContext;
let browser: Browser;
let site: SiteRecord;
let host: string;
let submissionId: string | undefined;
let prospectId: string | undefined;
let notificationId: string | undefined;

function find(layers: Layer[], match: (layer: Layer) => boolean): Layer | null {
  for (const layer of layers) {
    if (match(layer)) return layer;
    const found = find(layer.children ?? [], match);
    if (found) return found;
  }
  return null;
}

async function data<T = Record<string, any>>(response: APIResponse, status = 200): Promise<T> {
  expect(response.status(), await response.text()).toBe(status);
  return (await response.json()).data as T;
}

const inboxOf = () => request.newContext({ baseURL: NOTIFICATIONS_URL, extraHTTPHeaders: { authorization: `Bearer ${token}` } });

test.beforeAll(async ({ baseURL: configured }) => {
  baseURL = configured!;
  builderHost = new URL(baseURL).host;
  token = await accessToken();
  api = await signInWithToken(baseURL, token);
  browser = await chromium.launch();
  site = await createSite(api, { name: `E2E contact ${RUN}`, slug: `e2e-contact-${RUN}`, languages: ['en', 'ar'], default_language: 'en' });
  host = `${site.slug}.${SITES_DOMAIN}`;
  expect(site.hosts).toEqual([host]);
  expect((await openSite(api, site.id)).status()).toBe(303);
});

test.afterAll(async () => {
  // Whatever failed above, the prospect is set aside and marked, and the notification no longer shows as unread.
  if (prospectId) await markTestProspect(token, prospectId);
  if (notificationId) {
    const inbox = await inboxOf();
    try {
      await inbox.post('/api/notifications/me/mark-read', { data: { notificationIds: [notificationId] } });
    } finally {
      await inbox.dispose();
    }
  }
  await deleteSite(api, site);
  await api?.dispose();
  await browser?.close();
});

test('the reports leaf reached the session, and what part 3 keeps hidden is hidden for a Manager too', async () => {
  // The scope is published again at every start and auth-service merges the new leaf into the system profiles: the
  // test account's Manager, signed in after the deployment, holds manage_reports.
  const session = await data<{ permissions: Record<string, string[]> }>(await api.get('/ycode/api/auth/session', { headers: { accept: 'application/json' } }));
  for (const leaf of ['manage_sites', 'manage_content', 'manage_forms', 'manage_orders', 'manage_reports']) {
    expect(session.permissions[`webstudio.${leaf}`], `the session's flags on webstudio.${leaf}`).toEqual(expect.arrayContaining(['r']));
  }

  // The webhooks, the API keys and the apps that part 3 leaves out answer 404 to everyone, a Manager included.
  for (const path of ['/ycode/api/webhooks', '/ycode/api/api-keys', '/ycode/integrations/webhooks', '/ycode/integrations/api']) {
    expect((await api.get(path)).status(), path).toBe(404);
  }
  const apps = await data<Array<{ id: string }>>(await api.get('/ycode/api/apps'));
  expect(apps.map((app) => app.id).sort()).toEqual(['google-maps-embed', 'mapbox', 'static-export']);

  // The Collections list route is on the content leaf and answers for a site with none.
  const collections = await api.get(`/ycode/api/platform/sites/${site.id}/collections`);
  expect(collections.status(), await collections.text()).toBe(200);
  expect(await collections.json()).toEqual({ data: [], can_change: true });
});

test('the builder shows Forms and CMS and offers the Contact form element, which has the prospect switch on; every request stays on the builder\'s host', async ({ browser: builder }) => {
  test.setTimeout(240_000);
  const context = await builder.newContext({ baseURL, storageState: await api.storageState(), viewport: { width: 1600, height: 1000 } });
  const hosts = watchHosts(context);
  try {
    const page = await context.newPage();
    await page.goto(`/ycode/api/platform/sites/${site.id}/open`);
    await expect(page.getByRole('button', { name: 'Design', exact: true })).toBeVisible({ timeout: 90_000 });
    await expect(page.getByRole('button', { name: 'CMS', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Forms', exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Add layout' }).click();
    await page.getByRole('tab', { name: 'Elements' }).click();
    await page.getByRole('button', { name: 'Contact form', exact: true }).click();
    await expect(page.getByText('Saved', { exact: true })).toBeVisible({ timeout: 30_000 });
    await page.getByRole('tabpanel', { name: 'Layers' }).getByRole('button', { name: 'Contact form', exact: true }).click();
    await page.getByRole('tab', { name: 'Settings' }).click();
    await expect(page.getByRole('switch', { name: 'Create a prospect in Contact Center' })).toHaveAttribute('aria-checked', 'true');

    // The two screens the buttons open answer, with nothing in them yet.
    await page.getByRole('button', { name: 'Forms', exact: true }).click();
    await expect(page).toHaveURL(/\/ycode\/forms$/);
    await page.getByRole('button', { name: 'CMS', exact: true }).click();
    await expect(page).toHaveURL(/\/ycode\/collections$/);
    await expect(page.getByText('No collections yet.')).toBeVisible();
    await expect(page.getByText(/Application error|Something went wrong/i)).toHaveCount(0);
    await page.waitForLoadState('networkidle');
  } finally {
    await context.close();
  }

  // What the builder saved: the form, with its switch and its two required fields.
  const home = (await draftPages(api)).find((row) => row.is_index)!;
  const layers = (await data<{ layers: Layer[] }>(await api.get(`/ycode/api/layers?page_id=${home.id}`))).layers;
  const form = find(layers, (layer) => layer.name === 'form');
  expect(form?.settings?.id).toBe('contact-form');
  expect(form?.settings?.form?.create_prospect).toBe(true);
  expect(['name', 'phone', 'email', 'message'].map((name) => find([form!], (layer) => layer.attributes?.name === name)?.attributes?.required === true)).toEqual([true, true, false, false]);
  await publish(api);

  const edge = [...hosts].filter((name) => EDGE_INJECTED.includes(name));
  if (edge.length > 0) {
    test.info().annotations.push({ type: 'known exception', description: `${edge.join(', ')}: injected into the builder's HTML by Cloudflare's edge, not by the app (part 2 OPEN_QUESTIONS 53)` });
  }
  expect([...hosts].filter((name) => !EDGE_INJECTED.includes(name)), 'hosts the builder contacted').toEqual([builderHost]);
});

test('a visitor\'s browser views the published page and sends the form: one view, one stored submission, no cookie, only the site\'s own host', async () => {
  const context = await browser.newContext({ baseURL: `https://${host}`, userAgent: WINDOWS, viewport: { width: 1280, height: 900 } });
  const hosts = watchHosts(context);
  try {
    const page = await context.newPage();
    const viewSent = page.waitForResponse((response) => new URL(response.url()).pathname === '/studio/api/visits' && response.request().method() === 'POST');
    const opened = await page.goto('/');
    expect(opened?.status()).toBe(200);
    // The page tells its own host that it was viewed: 204, counted or not (the report below says which).
    expect((await viewSent).status()).toBe(204);

    const form = page.locator('form#contact-form').first();
    await form.locator('[name="name"]').fill(TEST_PROSPECT.name);
    await form.locator('[name="phone"]').fill(TEST_PROSPECT.phone);
    await form.locator('[name="message"]').fill(MESSAGE);
    const sent = page.waitForResponse((response) => new URL(response.url()).pathname === '/studio/api/form-submissions' && response.request().method() === 'POST');
    await form.getByRole('button').last().click();
    expect((await sent).status()).toBe(201);
    await expect(form.locator('[data-alert-type="success"]')).toBeVisible();

    await page.waitForLoadState('networkidle');
    expect(await context.cookies(), 'a visitor is given no cookie').toEqual([]);
  } finally {
    await context.close();
  }
  expect([...hosts], 'hosts the published page contacted').toEqual([host]);
});

test('the submission is in the app\'s API as a prospect, Contact Center holds it, and the people who may read it are told', async () => {
  // The list: one submission, unread, from the form, with its Contact Center state. The call to Contact Center
  // is made while the visitor's request waits (3 seconds at most), so the state is there at once; poll for a slow one.
  type Row = { id: string; unread: boolean; form: { id: string }; sender: { name: string; phone: string }; contact_center: { state: string; kind: string | null; id: string | null } };
  let row: Row | undefined;
  await expect(async () => {
    const rows = await data<Row[]>(await api.get(`/ycode/api/platform/sites/${site.id}/submissions`));
    expect(rows).toHaveLength(1);
    row = rows[0];
    expect(row.contact_center.state).toBe('prospect');
  }).toPass({ timeout: 45_000 });
  expect(row).toMatchObject({ unread: true, form: { id: 'contact-form' }, sender: { name: TEST_PROSPECT.name, phone: TEST_PROSPECT.phone }, contact_center: { state: 'prospect', kind: 'prospect' } });
  submissionId = row!.id;
  prospectId = row!.contact_center.id!;
  expect(prospectId).toMatch(/^[0-9a-f-]{36}$/);

  // The unread count of the site and of the organization, before the submission is opened.
  const counts = await data<{ count: number; sites: Array<{ id: string; count: number }> }>(await api.get('/ycode/api/platform/submissions/unread-count'));
  expect(counts.sites.find((entry) => entry.id === site.id)?.count).toBe(1);
  expect(counts.count).toBeGreaterThanOrEqual(1);

  // The prospect in the real Contact Center, through the user's token: a prospect from a web form, with the message.
  const cc = await request.newContext({ baseURL: CONTACT_CENTER_URL, extraHTTPHeaders: { authorization: `Bearer ${token}` } });
  try {
    const prospect = await data<{ id: string; kind: string; name: string; phone: string | null; source: string; notes: string | null }>(await cc.get(`/api/v1/prospects/${prospectId}`));
    expect(prospect).toMatchObject({ id: prospectId, kind: 'PERSON', source: 'WEB_FORM', name: TEST_PROSPECT.name });
    expect(prospect.phone?.replace(/\D/g, ''), 'the phone Contact Center holds').toMatch(new RegExp(`${TEST_PROSPECT.canonical.slice(3)}$`));
    expect(prospect.notes ?? '', 'the visitor\'s message is in its notes').toContain(MESSAGE);
  } finally {
    await cc.dispose();
  }

  // Opening it reads it, and answers the deep link into Contact Center (CONTACT_CENTER_APP_ID is set on the service).
  const detail = await data<{ fields: Array<{ name: string; value: string | string[] }>; links: { open_in_contact_center: string | null } }>(await api.get(`/ycode/api/platform/sites/${site.id}/submissions/${submissionId}`));
  expect(detail.links.open_in_contact_center).toMatch(new RegExp(`^torch://app/[0-9a-f-]{36}/prospects/${prospectId}$`));
  expect(detail.fields.find((field) => field.name === 'message')?.value).toBe(MESSAGE);
  const after = await data<{ sites: Array<{ id: string; count: number }> }>(await api.get('/ycode/api/platform/submissions/unread-count'));
  expect(after.sites.find((entry) => entry.id === site.id)?.count).toBe(0);

  // The prospect is set aside and marked now, not only at the end.
  await markTestProspect(token, prospectId);

  // The notification: the test user holds manage_forms r, so the inbox has it, with the form and the site, and the
  // link the shell opens (NOTIFICATION_ENGINE_URL, NOTIFICATION_ENGINE_API_KEY and WS_APP_ID are set on the service).
  const inbox = await inboxOf();
  try {
    await expect(async () => {
      const listed = await inbox.get('/api/notifications/me?limit=50&unreadOnly=true');
      expect(listed.status(), await listed.text()).toBe(200);
      const mine = ((await listed.json()).data as Array<{ id: string; title: string; body: string; senderApp: string; actionUrl: string | null }>).find((item) => item.actionUrl?.endsWith(`/sites/${site.id}/contact-form/${submissionId}`));
      expect(mine, 'the notification of this submission').toBeTruthy();
      notificationId = mine!.id;
      expect(mine!.title).toBe('New form submission');
      expect(mine!.body).toBe(`${TEST_PROSPECT.name} sent contact-form on ${site.name}.`);
      expect(mine!.actionUrl).toMatch(new RegExp(`^torch://app/[0-9a-f-]{36}/sites/${site.id}/contact-form/${submissionId}$`));
    }).toPass({ timeout: 45_000 });
  } finally {
    await inbox.dispose();
  }
});

test('the Traffic, Conversions and summary reports answer with that one view and that one form', async () => {
  const traffic = await data<Record<string, any>>(await api.get(`/ycode/api/platform/sites/${site.id}/reports/traffic?period=today`));
  expect(traffic.no_data, 'the view was counted: WS_VISIT_SALT is set and the client address reaches the service').toBe(false);
  expect(traffic.period).toMatchObject({ key: 'today', days: 1 });
  expect(traffic.views).toBe(1);
  expect(traffic.visitors_per_day).toBe(1);
  expect(traffic.series).toHaveLength(1);
  expect(traffic.series[0]).toMatchObject({ views: 1, visitors: 1 });
  expect(traffic.pages.top).toHaveLength(1);
  expect(traffic.pages.top[0]).toMatchObject({ path: '/', views: 1, share: 100 });
  expect(traffic.sources.map((entry: { source: string }) => entry.source)).toEqual(['direct', 'search', 'social', 'referral']);
  expect(traffic.sources[0]).toMatchObject({ source: 'direct', views: 1, share: 100 });
  expect(traffic.devices.find((entry: { device: string }) => entry.device === 'desktop')).toMatchObject({ views: 1, share: 100 });

  // The site does not sell: the funnel is the visitors and the forms, and no cart or order step.
  const conversions = await data<Record<string, any>>(await api.get(`/ycode/api/platform/sites/${site.id}/reports/conversions?period=today`));
  expect(conversions.sells).toBe(false);
  expect(conversions.no_data).toBe(false);
  expect(conversions.steps).toEqual([
    { step: 'visitors', count: 1, share: 100 },
    { step: 'forms', count: 1, share: 100 },
  ]);

  // The Dashboard's summary lists the organization's live sites, this one published with its view; a failed read of a
  // site would be an error here, not a missing row.
  const summary = await data<Record<string, any>>(await api.get('/ycode/api/platform/reports/summary?period=today'));
  expect(summary.period).toMatchObject({ key: 'today', days: 1 });
  expect(summary.total.views).toBeGreaterThanOrEqual(1);
  const mine = summary.sites.find((entry: { id: string }) => entry.id === site.id);
  expect(mine).toMatchObject({ name: site.name, status: 'published', views: 1 });
  expect(mine.views_by_day).toEqual([{ day: traffic.series[0].day, views: 1 }]);

  // A custom range and a refused period answer as the app reads them.
  const day = traffic.series[0].day as string;
  const range = await data<Record<string, any>>(await api.get(`/ycode/api/platform/sites/${site.id}/reports/traffic?from=${day}&to=${day}`));
  expect(range.period).toMatchObject({ key: 'custom', from: day, to: day, days: 1 });
  expect(range.views).toBe(1);
  const refused = await api.get(`/ycode/api/platform/sites/${site.id}/reports/traffic?period=last_year`);
  expect(refused.status()).toBe(400);
  expect((await refused.json()).code).toBe('invalid_period');
});
