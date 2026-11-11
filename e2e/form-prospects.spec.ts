/**
 * Part 3, session W3 "done when": a form can send its submissions to Contact Center, and each submission knows
 * what became of it (`platform_form_links`), against the stub Contact Center (e2e/order-services-stub.ts).
 *
 * The builder: the Contact form element has "Create a prospect in Contact Center" on and the Form element has it
 * off; with it on, removing the phone field or making it optional is refused with the reason, and the switch is
 * refused for a form that lacks a required field.
 *
 * The published site: a visitor's phone is checked on the page and again by the server; the switch on makes one
 * call and the state 'prospect'; a contact's phone gives 'contact'; the switch off never calls, whatever the body
 * claims; spam is stored and not sent; with Contact Center down the visitor still succeeds, the state is
 * 'waiting', and the retry sets it once Contact Center is back and the row's delay has passed.
 */

import knex, { type Knex } from 'knex';
import { chromium, expect, request, test, type APIRequestContext, type Browser, type Page } from '@playwright/test';
import { createSite, draftPages, openSite, publish, signIn, TEST_SITES_DOMAIN, type SiteRecord } from './helpers';
import { CONTACT_CENTER_KEY } from './platform-fixtures';
import { HONEYPOT_FIELD_NAME } from '../lib/form-spam-settings';

test.describe.configure({ mode: 'serial' });

const RUN = Date.now().toString(36);
const PORT = Number(process.env.E2E_PORT || 3102);
const PLATFORM = `http://127.0.0.1:${Number(process.env.E2E_PLATFORM_PORT || PORT + 3)}`;
const ORG = '9a9a9a9a-9a9a-4a9a-8a9a-9a9a9a9a9a9a';
const USER = { sub: '9b9b9b9b-9b9b-4b9b-8b9b-9b9b9b9b9b9b', email: 'owner-prospects@example.com', name: 'Owner Prospects', org: ORG };
const PROSPECTS_PATH = '/api/v1/internal/prospects/find-or-create';

/** Seven digits of this run, so the stub's prospects from an earlier run never match. */
const SEVEN = String(Date.now() % 10_000_000).padStart(7, '0');
/** An Iraqi mobile of this run as a visitor types it (0770…), and as Contact Center is sent it (964770…). */
const typed = (n: number) => `077${n} ${SEVEN.slice(0, 3)} ${SEVEN.slice(3)}`;
const canonical = (n: number) => `96477${n}${SEVEN}`;

interface Layer {
  id: string;
  name: string;
  attributes?: Record<string, unknown>;
  settings?: { id?: string; form?: { create_prospect?: boolean } };
  children?: Layer[];
}

interface Call {
  path: string;
  entityId: string | null;
  body: Record<string, unknown> | null;
  status: number;
  response: Record<string, unknown>;
}

interface LinkRow {
  submission_id: string;
  state: string;
  contact_center_id: string | null;
  attempts: number;
  last_attempt_at: Date | null;
}

let baseURL: string;
let owner: APIRequestContext;
let site: SiteRecord;
let browser: Browser;
let db: Knex;
let storage: Awaited<ReturnType<APIRequestContext['storageState']>>;
/** The layer ids of the three published forms. */
let contactFormLayer: string;
const PLAIN_LAYER = 'lyr-plain-form';
const TWIN_LAYER = 'lyr-twin-form';
let visitorNumber = 0;

const origin = () => `http://${site.slug}.${TEST_SITES_DOMAIN}:${PORT}`;

function find(layers: Layer[], match: (layer: Layer) => boolean): Layer | null {
  for (const layer of layers) {
    if (match(layer)) return layer;
    const found = find(layer.children ?? [], match);
    if (found) return found;
  }
  return null;
}

async function home(): Promise<{ id: string; layers: Layer[] }> {
  const page = (await draftPages(owner)).find((row) => row.is_index)!;
  const response = await owner.get(`/ycode/api/layers?page_id=${page.id}`);
  expect(response.status(), await response.text()).toBe(200);
  return { id: page.id, layers: (await response.json()).data.layers as Layer[] };
}

/** A form with a name and a phone field, as the layers API stores it. */
function formLayer(id: string, formId: string): Layer {
  const input = (name: string): Layer => ({ id: `${id}-${name}`, name: 'input', attributes: { type: 'text', name, required: true }, children: [] });
  return { id, name: 'form', settings: { id: formId }, attributes: { method: 'POST', action: '' }, children: [input('name'), input('phone')] };
}

async function control(path: string, data: unknown): Promise<void> {
  const context = await request.newContext();
  try {
    expect((await context.post(`${PLATFORM}${path}`, { data })).status()).toBe(200);
  } finally {
    await context.dispose();
  }
}
const contactCenterDown = (down: boolean) => control('/__down', { services: down ? ['contact-center'] : [] });

/** The prospect calls this organization's sites have made. */
async function prospectCalls(): Promise<Call[]> {
  const context = await request.newContext();
  try {
    const { calls } = (await (await context.get(`${PLATFORM}/__calls?service=contact-center`)).json()) as { calls: Call[] };
    return calls.filter((call) => call.path === PROSPECTS_PATH && call.entityId === ORG);
  } finally {
    await context.dispose();
  }
}

/** A visitor's own request to the site's submit route, each from an address of its own (the rate limit counts per address). */
function visitor(): Promise<APIRequestContext> {
  visitorNumber += 1;
  const host = site.hosts[0];
  return request.newContext({ baseURL, extraHTTPHeaders: { 'x-forwarded-host': host, origin: `http://${host}`, 'x-forwarded-for': `203.0.113.${visitorNumber}` } });
}

async function submit(body: Record<string, unknown>): Promise<{ status: number; json: { data?: { id: string }; code?: string; fields?: Record<string, string> } }> {
  const api = await visitor();
  try {
    const response = await api.post('/studio/api/form-submissions', { data: body });
    return { status: response.status(), json: await response.json() };
  } finally {
    await api.dispose();
  }
}

const linkOf = (submissionId: string) => db('platform_form_links').where({ submission_id: submissionId }).first() as Promise<LinkRow | undefined>;
const links = () => db('platform_form_links').where({ site_id: site.id }) as Promise<LinkRow[]>;
const submissions = () => db('form_submissions').where({ tenant_id: site.id }) as Promise<Array<{ id: string; status: string }>>;

async function openBuilder(page: Page): Promise<void> {
  await page.goto(`/ycode/api/platform/sites/${site.id}/open`);
  await expect(page.getByRole('button', { name: 'Design', exact: true })).toBeVisible({ timeout: 60_000 });
}

test.beforeAll(async ({ baseURL: configured }) => {
  baseURL = configured!;
  db = knex({ client: 'pg', connection: process.env.DATABASE_URL_TEST });
  owner = await signIn(baseURL, USER);
  site = await createSite(owner, { name: 'Prospects', slug: `prospects-${RUN}`, languages: ['en'], default_language: 'en' });
  expect((await openSite(owner, site.id)).status()).toBe(303);
  storage = await owner.storageState();
  browser = await chromium.launch({ args: [`--host-resolver-rules=MAP *.${TEST_SITES_DOMAIN} 127.0.0.1`] });
  await contactCenterDown(false);
});

test.afterAll(async () => {
  await contactCenterDown(false);
  await browser?.close();
  if (site) await owner.delete(`/ycode/api/platform/sites/${site.id}`);
  await owner?.dispose();
  await db?.destroy();
});

test('the Contact form element has the switch on and the Form element has it off', async ({ browser: builderBrowser }) => {
  const context = await builderBrowser.newContext({ baseURL, storageState: storage, viewport: { width: 1600, height: 1000 } });
  try {
    const page = await context.newPage();
    await openBuilder(page);
    const layers = page.getByRole('tabpanel', { name: 'Layers' });
    const prospectSwitch = page.getByRole('switch', { name: 'Create a prospect in Contact Center' });

    await page.getByRole('button', { name: 'Add layout' }).click();
    await page.getByRole('tab', { name: 'Elements' }).click();
    await page.getByRole('button', { name: 'Form', exact: true }).click();
    await expect(page.getByText('Saved', { exact: true })).toBeVisible({ timeout: 20_000 });
    await layers.getByRole('button', { name: 'Form', exact: true }).click();
    await page.getByRole('tab', { name: 'Settings' }).click();
    await expect(prospectSwitch).toHaveAttribute('aria-checked', 'false');

    // The Form element has a name and no phone: the switch is refused, and says what is missing.
    await prospectSwitch.click();
    await expect(page.getByText(/cannot create prospects yet: it needs a required field named "phone"/)).toBeVisible();
    await expect(prospectSwitch).toHaveAttribute('aria-checked', 'false');
    await expect(async () => {
      const form = find((await home()).layers, (layer) => layer.name === 'form');
      expect(form, 'the Form element is saved').not.toBeNull();
      expect(form!.settings?.form?.create_prospect ?? false).toBe(false);
    }).toPass({ timeout: 20_000 });
  } finally {
    await context.close();
  }

  // The page starts again with the Contact form alone.
  const { id } = await home();
  expect((await owner.put(`/ycode/api/layers?page_id=${id}`, { data: { layers: [{ id: 'body', name: 'body', classes: '', children: [] }] } })).status()).toBe(200);

  const second = await builderBrowser.newContext({ baseURL, storageState: storage, viewport: { width: 1600, height: 1000 } });
  try {
    const page = await second.newPage();
    await openBuilder(page);
    await page.getByRole('button', { name: 'Add layout' }).click();
    await page.getByRole('tab', { name: 'Elements' }).click();
    await page.getByRole('button', { name: 'Contact form', exact: true }).click();
    await expect(page.getByText('Saved', { exact: true })).toBeVisible({ timeout: 20_000 });
    await page.getByRole('tabpanel', { name: 'Layers' }).getByRole('button', { name: 'Contact form', exact: true }).click();
    await page.getByRole('tab', { name: 'Settings' }).click();
    await expect(page.getByRole('switch', { name: 'Create a prospect in Contact Center' })).toHaveAttribute('aria-checked', 'true');
  } finally {
    await second.close();
  }

  await expect(async () => {
    const form = find((await home()).layers, (layer) => layer.name === 'form');
    expect(form?.settings?.form?.create_prospect).toBe(true);
    const fields = ['name', 'phone', 'email', 'message'].map((name) => find([form!], (layer) => layer.attributes?.name === name));
    expect(fields.map((field) => field?.attributes?.required === true)).toEqual([true, true, false, false]);
  }).toPass({ timeout: 20_000 });
});

test('with the switch on, the builder refuses to remove the phone field or to make it optional, and says why', async ({ browser: builderBrowser }) => {
  const context = await builderBrowser.newContext({ baseURL, storageState: storage, viewport: { width: 1600, height: 1000 } });
  try {
    const page = await context.newPage();
    await openBuilder(page);
    const canvas = page.frameLocator('iframe').first();
    const phone = canvas.locator('input[name="phone"]');
    const reason = page.getByText(/creates a prospect in Contact Center, so it must keep a required field named "phone"/);
    const required = page.getByRole('checkbox', { name: 'Required' });

    // Making it optional
    await phone.click();
    await page.getByRole('tab', { name: 'Settings' }).click();
    await expect(required).toBeChecked();
    await required.click();
    await expect(reason.first()).toBeVisible();
    await expect(required).toBeChecked();

    // Removing it
    await phone.click();
    await page.keyboard.press('Delete');
    await expect(reason.nth(1)).toBeVisible();
    await expect(phone).toHaveCount(1);

    // With the switch off the field is free.
    await page.getByRole('tabpanel', { name: 'Layers' }).getByRole('button', { name: 'Contact form', exact: true }).click();
    const prospectSwitch = page.getByRole('switch', { name: 'Create a prospect in Contact Center' });
    await prospectSwitch.click();
    await expect(prospectSwitch).toHaveAttribute('aria-checked', 'false');
    await phone.click();
    await required.click();
    await expect(required).not.toBeChecked();

    // And back: the switch is refused until the phone is required again.
    await page.getByRole('tabpanel', { name: 'Layers' }).getByRole('button', { name: 'Contact form', exact: true }).click();
    await prospectSwitch.click();
    await expect(page.getByText(/cannot create prospects yet: it needs a required field named "phone"/)).toBeVisible();
    await expect(prospectSwitch).toHaveAttribute('aria-checked', 'false');
    await phone.click();
    await required.click();
    await expect(required).toBeChecked();
    await page.getByRole('tabpanel', { name: 'Layers' }).getByRole('button', { name: 'Contact form', exact: true }).click();
    await prospectSwitch.click();
    await expect(prospectSwitch).toHaveAttribute('aria-checked', 'true');

    await expect(async () => {
      const form = find((await home()).layers, (layer) => layer.name === 'form');
      expect(form?.settings?.form?.create_prospect).toBe(true);
      expect(find([form!], (layer) => layer.attributes?.name === 'phone')?.attributes?.required).toBe(true);
    }).toPass({ timeout: 20_000 });
  } finally {
    await context.close();
  }
});

test('the site publishes with three forms: the contact form (on), a plain form (off) and a form that shares the contact form\'s id (off)', async () => {
  const { id, layers } = await home();
  const body = find(layers, (layer) => layer.id === 'body')!;
  const contactForm = find(layers, (layer) => layer.name === 'form')!;
  contactFormLayer = contactForm.id;
  expect(contactForm.settings?.id).toBe('contact-form');
  body.children = [...(body.children ?? []), formLayer(PLAIN_LAYER, 'plain-form'), formLayer(TWIN_LAYER, 'contact-form')];
  expect((await owner.put(`/ycode/api/layers?page_id=${id}`, { data: { layers } })).status()).toBe(200);
  await publish(owner);
  expect(await links()).toEqual([]);
});

test('a visitor\'s phone is checked on the page; a good one makes one call to Contact Center and the state prospect', async () => {
  const before = (await prospectCalls()).length;
  const context = await browser.newContext({ baseURL: origin() });
  try {
    const page = await context.newPage();
    expect((await page.goto('/'))?.status()).toBe(200);
    const form = page.locator('form#contact-form').first();
    const phone = form.locator('[name="phone"]');
    await form.locator('[name="name"]').fill('Ali Hassan');
    await form.locator('[name="message"]').fill('Please call me back');

    // Not an Iraqi mobile: the page says so on the field and sends nothing.
    await phone.fill('12345');
    await form.getByRole('button').last().click();
    await expect.poll(() => phone.evaluate((input: HTMLInputElement) => input.validationMessage)).toMatch(/Enter an Iraqi mobile number/);
    expect(await submissions()).toEqual([]);

    await phone.fill(typed(1));
    await form.getByRole('button').last().click();
    await expect(form.locator('[data-alert-type="success"]')).toBeVisible();
  } finally {
    await context.close();
  }

  const stored = await submissions();
  expect(stored).toHaveLength(1);
  const made = (await prospectCalls()).slice(before);
  expect(made).toHaveLength(1);
  expect(made[0].status).toBe(201);
  expect(made[0].body).toEqual({ name: 'Ali Hassan', phone: canonical(1), notes: 'Please call me back', origin: 'web_form' });
  const link = await linkOf(stored[0].id);
  expect(link).toMatchObject({ state: 'prospect', contact_center_id: made[0].response.id, attempts: 1 });
});

test('the server checks the name and the phone again: a bad one is refused in the page\'s language and nothing is stored or sent', async () => {
  const calls = (await prospectCalls()).length;
  const stored = (await submissions()).length;
  const bad = await submit({ form_id: 'contact-form', layer_id: contactFormLayer, locale: 'en', payload: { name: ' ', phone: '+1 202 555 0100' } });
  expect(bad.status).toBe(400);
  expect(bad.json.code).toBe('invalid_fields');
  expect(bad.json.fields).toEqual({ name: 'Enter your name.', phone: 'Enter an Iraqi mobile number, such as 0770 123 4567 or +964 770 123 4567.' });
  const arabic = await submit({ form_id: 'contact-form', layer_id: contactFormLayer, locale: 'ar', payload: { name: 'علي', phone: '0160123456' } });
  expect(arabic.status).toBe(400);
  expect(Object.keys(arabic.json.fields ?? {})).toEqual(['phone']);
  expect(arabic.json.fields?.phone).toMatch(/أدخل رقم هاتف محمول عراقي/);
  expect(await submissions()).toHaveLength(stored);
  expect(await prospectCalls()).toHaveLength(calls);
});

test('the same phone again is the same prospect, and a contact\'s phone gives the state contact', async () => {
  const first = (await links())[0];
  const again = await submit({ form_id: 'contact-form', layer_id: contactFormLayer, payload: { name: 'Ali H.', phone: `+${canonical(1)}`, email: 'ali@example.com' } });
  expect(again.status).toBe(201);
  expect(await linkOf(again.json.data!.id)).toMatchObject({ state: 'prospect', contact_center_id: first.contact_center_id });
  const last = (await prospectCalls()).at(-1)!;
  expect(last.status).toBe(200);
  expect(last.body).toEqual({ name: 'Ali H.', phone: canonical(1), email: 'ali@example.com', origin: 'web_form' });

  // A contact of the organization with another phone, made the way checkout makes its buyers.
  const contactCenter = await request.newContext({ extraHTTPHeaders: { 'x-service-api-key': CONTACT_CENTER_KEY, 'x-entity-id': ORG } });
  let personId: string;
  try {
    const made = await contactCenter.post(`${PLATFORM}/api/v1/internal/persons/find-or-create`, { data: { name: 'Sara Contact', phone: canonical(2), origin: 'storefront' } });
    expect(made.status()).toBe(201);
    personId = (await made.json()).person_id;
  } finally {
    await contactCenter.dispose();
  }
  const before = (await prospectCalls()).length;
  const sent = await submit({ form_id: 'contact-form', layer_id: contactFormLayer, payload: { name: 'Sara', phone: typed(2), message: 'An order question' } });
  expect(sent.status).toBe(201);
  expect(await prospectCalls()).toHaveLength(before + 1);
  expect(await linkOf(sent.json.data!.id)).toMatchObject({ state: 'contact', contact_center_id: personId, attempts: 1 });
});

test('the switch off never calls Contact Center, whatever the body claims', async () => {
  const before = (await prospectCalls()).length;
  const claims = { create_prospect: true, settings: { form: { create_prospect: true } }, form: { create_prospect: true } };
  const sent = [
    // The plain form, as its page sends it.
    await submit({ form_id: 'plain-form', layer_id: PLAIN_LAYER, payload: { name: 'Omar', phone: typed(3) } }),
    // The same, claiming the switch in every place a body could.
    await submit({ form_id: 'plain-form', layer_id: PLAIN_LAYER, ...claims, payload: { name: 'Omar', phone: typed(3), create_prospect: 'true' } }),
    // The plain form's id with the contact form's layer: no such published form, and no plain form is on.
    await submit({ form_id: 'plain-form', layer_id: contactFormLayer, ...claims, payload: { name: 'Omar', phone: typed(3) } }),
    // The form that shares the contact form's id and has the switch off is told apart by its layer.
    await submit({ form_id: 'contact-form', layer_id: TWIN_LAYER, payload: { name: 'Omar', phone: typed(3) } }),
    // A form with the switch off takes any phone: nothing is checked.
    await submit({ form_id: 'plain-form', layer_id: PLAIN_LAYER, payload: { name: '', phone: 'call me' } }),
  ];
  for (const answer of sent) {
    expect(answer.status).toBe(201);
    expect(await linkOf(answer.json.data!.id)).toMatchObject({ state: 'stored', contact_center_id: null, attempts: 0, last_attempt_at: null });
  }
  expect(await prospectCalls()).toHaveLength(before);
});

test('a visitor cannot switch a form off: a body that names no published layer of the contact form still creates the prospect', async () => {
  const before = (await prospectCalls()).length;
  const noLayer = await submit({ form_id: 'contact-form', create_prospect: false, payload: { name: 'Noor', phone: typed(4) } });
  const madeUp = await submit({ form_id: 'contact-form', layer_id: 'lyr-made-up', create_prospect: false, payload: { name: 'Noor', phone: typed(4) } });
  for (const answer of [noLayer, madeUp]) {
    expect(answer.status).toBe(201);
    expect((await linkOf(answer.json.data!.id))?.state).toBe('prospect');
  }
  expect(await prospectCalls()).toHaveLength(before + 2);
  // And its rule holds too: no phone, no submission.
  expect((await submit({ form_id: 'contact-form', payload: { name: 'Noor' } })).status).toBe(400);
});

test('spam of the contact form is stored for review and not sent', async () => {
  const before = (await prospectCalls()).length;
  const caught = await submit({ form_id: 'contact-form', layer_id: contactFormLayer, payload: { name: 'Bot', phone: 'buy now', [HONEYPOT_FIELD_NAME]: 'gotcha' } });
  expect(caught.status).toBe(201);
  expect((await submissions()).find((row) => row.id === caught.json.data!.id)?.status).toBe('spam');
  expect(await linkOf(caught.json.data!.id)).toMatchObject({ state: 'stored', attempts: 0 });
  expect(await prospectCalls()).toHaveLength(before);
});

test('with Contact Center down the visitor still succeeds and the submission waits; back up, the retry sets it after its delay', async () => {
  await contactCenterDown(true);
  let id: string;
  try {
    const started = Date.now();
    const sent = await submit({ form_id: 'contact-form', layer_id: contactFormLayer, payload: { name: 'Zainab', phone: typed(5), message: 'Is anyone there?' } });
    expect(sent.status).toBe(201);
    expect(Date.now() - started).toBeLessThan(5_000);
    id = sent.json.data!.id;
    expect(await linkOf(id)).toMatchObject({ state: 'waiting', contact_center_id: null, attempts: 1 });
  } finally {
    await contactCenterDown(false);
  }

  // Contact Center is back and the run ticks every second, but the first delay (a minute) has not passed.
  const before = (await prospectCalls()).length;
  await new Promise((resolve) => setTimeout(resolve, 3_500));
  expect(await linkOf(id)).toMatchObject({ state: 'waiting', attempts: 1 });
  expect(await prospectCalls()).toHaveLength(before);

  // The minute passes (the last attempt is moved back): the next run asks again and sets the row.
  await db('platform_form_links').where({ submission_id: id }).update({ last_attempt_at: db.raw("now() - interval '61 seconds'") });
  await expect.poll(async () => (await linkOf(id))?.state, { timeout: 15_000 }).toBe('prospect');
  const made = (await prospectCalls()).slice(before);
  expect(made).toHaveLength(1);
  expect(made[0].body).toEqual({ name: 'Zainab', phone: canonical(5), notes: 'Is anyone there?', origin: 'web_form' });
  expect(await linkOf(id)).toMatchObject({ state: 'prospect', contact_center_id: made[0].response.id, attempts: 2 });

  // A row that failed twice waits two minutes, not one: the delay grows.
  await contactCenterDown(true);
  try {
    const sent = await submit({ form_id: 'contact-form', layer_id: contactFormLayer, payload: { name: 'Hadi', phone: typed(6) } });
    const second = sent.json.data!.id;
    await db('platform_form_links').where({ submission_id: second }).update({ last_attempt_at: db.raw("now() - interval '61 seconds'") });
    await expect.poll(async () => (await linkOf(second))?.attempts, { timeout: 15_000 }).toBe(2);
    await db('platform_form_links').where({ submission_id: second }).update({ last_attempt_at: db.raw("now() - interval '90 seconds'") });
    await new Promise((resolve) => setTimeout(resolve, 3_500));
    expect(await linkOf(second)).toMatchObject({ state: 'waiting', attempts: 2 });
    await db('platform_form_links').where({ submission_id: second }).update({ last_attempt_at: db.raw("now() - interval '121 seconds'") });
    await expect.poll(async () => (await linkOf(second))?.attempts, { timeout: 15_000 }).toBe(3);
    expect((await linkOf(second))?.state).toBe('waiting');
  } finally {
    await contactCenterDown(false);
  }
});

test('every submission of the site has one link', async () => {
  const stored = await submissions();
  const linked = await links();
  expect(linked.map((row) => row.submission_id).sort()).toEqual(stored.map((row) => row.id).sort());
});
