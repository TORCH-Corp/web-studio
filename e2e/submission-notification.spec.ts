/**
 * Part 3, session W5 "done when": a new form submission raises a Business OS notification to the members who hold
 * `r` on webstudio.manage_forms, against the stub Notification Center and Organization Setup (e2e/notification-stub.ts).
 *
 * One submission that is not spam: one notification to each holder (the Manager, the Member and the Viewer of
 * e2e/auth-fixtures.ts hold it; the one who manages orders only, and the one with no Web Studio leaf, do not), with
 * the English text and the deep link that opens the submission in the app, naming the form as the app's list does
 * (its custom name, else its id). Spam sends none. The visitor's answer
 * does not wait for the notification. With Notification Center down, or with Organization Setup down, the
 * submission is still stored and answered.
 */

import knex, { type Knex } from 'knex';
import { expect, request, test, type APIRequestContext } from '@playwright/test';
import { PEOPLE } from './auth-fixtures';
import { createSite, draftPages, openSite, publish, signIn, type SiteRecord } from './helpers';
import { WS_APP_ID } from './platform-fixtures';
import { HONEYPOT_FIELD_NAME } from '../lib/form-spam-settings';

test.describe.configure({ mode: 'serial' });

const RUN = Date.now().toString(36);
const PORT = Number(process.env.E2E_PORT || 3102);
const PLATFORM = `http://127.0.0.1:${Number(process.env.E2E_PLATFORM_PORT || PORT + 3)}`;
const ORG = '9c9c9c9c-9c9c-4c9c-8c9c-9c9c9c9c9c9c';
const USER = { sub: '9d9d9d9d-9d9d-4d9d-8d9d-9d9d9d9d9d9d', email: 'owner-notify@example.com', name: 'Owner Notify', org: ORG };
const SITE_NAME = 'Al Noor Trading';
const NOTIFICATIONS_PATH = '/api/notifications';

/** Who holds r on webstudio.manage_forms in e2e/auth-fixtures.ts: the Manager, the Member and the Viewer. */
const READERS = [PEOPLE.owner.sub, PEOPLE.member.sub, PEOPLE.viewer.sub].sort();

interface Call {
  path: string;
  entityId: string | null;
  headers: { senderApp: string | null };
  body: Record<string, unknown> | null;
  status: number;
}

let baseURL: string;
let owner: APIRequestContext;
let site: SiteRecord;
let db: Knex;
let visitorNumber = 0;

async function control(path: string, data: unknown): Promise<void> {
  const context = await request.newContext();
  try {
    expect((await context.post(`${PLATFORM}${path}`, { data })).status()).toBe(200);
  } finally {
    await context.dispose();
  }
}
const down = (services: string[]) => control('/__down', { services });
const delay = (ms: number) => control('/__notification/delay', { ms });

/** What the stub recorded for this organization: the notifications asked for, or the members and permission reads. */
async function recorded(service: 'notification' | 'org-setup'): Promise<Call[]> {
  const context = await request.newContext();
  try {
    const { calls } = (await (await context.get(`${PLATFORM}/__calls?service=${service}`)).json()) as { calls: Call[] };
    return calls.filter((call) => call.entityId === ORG);
  } finally {
    await context.dispose();
  }
}
const notifications = async () => (await recorded('notification')).filter((call) => call.path === NOTIFICATIONS_PATH);
const reads = async () => recorded('org-setup');

/** A visitor's own request to the site's submit route, from an address of its own (the rate limit counts per address). */
async function submit(payload: Record<string, unknown>, formId = 'contact-form'): Promise<{ status: number; ms: number; id?: string }> {
  visitorNumber += 1;
  const host = site.hosts[0];
  const api = await request.newContext({ baseURL, extraHTTPHeaders: { 'x-forwarded-host': host, origin: `http://${host}`, 'x-forwarded-for': `203.0.113.${visitorNumber}` } });
  try {
    const started = Date.now();
    const response = await api.post('/studio/api/form-submissions', { data: { form_id: formId, payload } });
    const ms = Date.now() - started;
    return { status: response.status(), ms, id: ((await response.json()) as { data?: { id: string } }).data?.id };
  } finally {
    await api.dispose();
  }
}

const stored = (id: string) => db('form_submissions').where({ id }).first() as Promise<{ id: string; status: string; form_id: string } | undefined>;

test.beforeAll(async ({ baseURL: configured }) => {
  baseURL = configured!;
  db = knex({ client: 'pg', connection: process.env.DATABASE_URL_TEST });
  owner = await signIn(baseURL, USER);
  site = await createSite(owner, { name: SITE_NAME, slug: `notify-${RUN}`, languages: ['en'], default_language: 'en' });
  expect((await openSite(owner, site.id)).status()).toBe(303);
  await publish(owner);
  await down([]);
  await delay(0);
});

test.afterAll(async () => {
  await down([]);
  await delay(0);
  if (site) await owner.delete(`/ycode/api/platform/sites/${site.id}`);
  await owner?.dispose();
  await db?.destroy();
});

test('one submission tells each holder of read on the forms permission once, in English, with the link that opens it', async () => {
  const sent = await submit({ name: 'Sara Ali', phone: '07701234567', message: 'Hello' });
  expect(sent.status).toBe(201);

  await expect.poll(async () => (await notifications()).length).toBe(READERS.length);
  // Nobody is told twice: wait well past the time the three calls took, and count again.
  await new Promise((resolve) => setTimeout(resolve, 1_000));
  const made = await notifications();
  expect(made).toHaveLength(READERS.length);
  expect(made.map((call) => call.status)).toEqual(READERS.map(() => 201));
  expect(made.map((call) => call.body!.recipientUserId).sort()).toEqual(READERS);
  for (const call of made) {
    expect(call.headers.senderApp).toBe('web-studio');
    expect(call.body).toMatchObject({
      channels: ['IN_APP'],
      title: 'New form submission',
      body: `Sara Ali sent contact-form on ${SITE_NAME}.`,
      category: 'TRANSACTIONAL',
      actionUrl: `torch://app/${WS_APP_ID}/sites/${site.id}/contact-form/${sent.id}`,
      metadata: { sourceEntityId: ORG },
    });
  }

  // Each member of the organization was asked once whether they hold r on the forms permission.
  const asked = (await reads()).filter((call) => call.path === '/api/internal/authz/evaluate');
  expect(asked.map((call) => (call.body as { userId: string }).userId).sort()).toEqual(Object.values(PEOPLE).map((person) => person.sub).sort());
  for (const call of asked) expect(call.body).toMatchObject({ entityId: ORG, leafKey: 'webstudio.manage_forms', flag: 'r' });
});

test('a form without a name field is told as from "A visitor"', async () => {
  const before = (await notifications()).length;
  const sent = await submit({ phone: '07701234567', message: 'No name given' }, 'callback');
  expect(sent.status).toBe(201);
  await expect.poll(async () => (await notifications()).length).toBe(before + READERS.length);
  const latest = (await notifications()).slice(before);
  for (const call of latest) expect(call.body!.body).toBe(`A visitor sent callback on ${SITE_NAME}.`);
});

test('a form is told by the name the app shows: its custom name when the builder gave it one', async () => {
  const page = (await draftPages(owner)).find((row) => row.is_index)!;
  const got = await owner.get(`/ycode/api/layers?page_id=${page.id}`);
  expect(got.status(), await got.text()).toBe(200);
  const layers = (await got.json()).data.layers as Array<{ id: string; children?: unknown[] }>;
  const body = layers.find((layer) => layer.id === 'body')!;
  body.children = [
    ...(body.children ?? []),
    { id: 'lyr-named-form', name: 'form', customName: 'Contact us', settings: { id: 'named-form' }, attributes: { method: 'POST', action: '' }, children: [] },
  ];
  expect((await owner.put(`/ycode/api/layers?page_id=${page.id}`, { data: { layers } })).status()).toBe(200);

  const before = (await notifications()).length;
  const sent = await submit({ name: 'Noor', phone: '07701234567' }, 'named-form');
  expect(sent.status).toBe(201);
  await expect.poll(async () => (await notifications()).length).toBe(before + READERS.length);
  for (const call of (await notifications()).slice(before)) expect(call.body!.body).toBe(`Noor sent Contact us on ${SITE_NAME}.`);
});

test('spam is stored for review and tells nobody', async () => {
  const notified = (await notifications()).length;
  const looked = (await reads()).length;
  const caught = await submit({ name: 'Bot', phone: 'buy now', [HONEYPOT_FIELD_NAME]: 'gotcha' });
  expect(caught.status).toBe(201);
  expect((await stored(caught.id!))?.status).toBe('spam');
  // The notification of a real submission starts within milliseconds of its answer; wait well past that.
  await new Promise((resolve) => setTimeout(resolve, 2_000));
  expect(await notifications()).toHaveLength(notified);
  expect(await reads()).toHaveLength(looked);
});

test('the visitor\'s answer does not wait for the notification', async () => {
  const before = (await notifications()).length;
  await delay(3_000);
  try {
    const sent = await submit({ name: 'Omar', phone: '07701234567' });
    expect(sent.status).toBe(201);
    expect(sent.ms).toBeLessThan(2_000);
    expect(await notifications(), 'still waiting on Notification Center').toHaveLength(before);
    await expect.poll(async () => (await notifications()).length, { timeout: 15_000 }).toBe(before + READERS.length);
  } finally {
    await delay(0);
  }
});

test('with Notification Center down the submission is still stored and answered, and each holder was tried once', async () => {
  const before = (await notifications()).length;
  await down(['notification']);
  try {
    const sent = await submit({ name: 'Zainab', phone: '07701234567' });
    expect(sent.status).toBe(201);
    expect(await stored(sent.id!)).toMatchObject({ id: sent.id, status: 'new' });
    await expect.poll(async () => (await notifications()).length).toBe(before + READERS.length);
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    const tried = (await notifications()).slice(before);
    expect(tried, 'none is retried').toHaveLength(READERS.length);
    expect(tried.map((call) => call.status)).toEqual(READERS.map(() => 503));
  } finally {
    await down([]);
  }
});

test('with Organization Setup down the submission is still stored and answered, and nobody is told', async () => {
  const before = (await notifications()).length;
  await down(['org-setup']);
  try {
    const sent = await submit({ name: 'Hadi', phone: '07701234567' });
    expect(sent.status).toBe(201);
    expect(await stored(sent.id!)).toMatchObject({ id: sent.id, status: 'new' });
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    expect(await notifications()).toHaveLength(before);
  } finally {
    await down([]);
  }
});
