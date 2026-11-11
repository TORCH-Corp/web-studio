/**
 * Part 3, session W4: the Submissions API for the app (PRD V1.0 "Submissions in Web Studio").
 *
 *   GET    /ycode/api/platform/sites/{id}/submissions            the site's submissions that are not spam, newest first
 *   GET    /ycode/api/platform/sites/{id}/submissions/{sid}      one with every field the visitor sent; reading sets it 'read'
 *   DELETE /ycode/api/platform/sites/{id}/submissions/{sid}      the submission and its link row; Contact Center is never called
 *   GET    /ycode/api/platform/sites/{id}/submissions/forms      the site's forms with their names, for the list's filter
 *   GET    /ycode/api/platform/submissions/unread-count          the organization's count and each site's
 *
 * `webstudio.manage_forms` r reads and d deletes (the proxy's check). The submissions are made the way a visitor
 * makes them, through the site's own submit route, against the stub Contact Center (e2e/order-services-stub.ts), so
 * the four states of a link are real ones.
 */

import knex, { type Knex } from 'knex';
import { expect, request, test, type APIRequestContext } from '@playwright/test';
import { createSite, draftPages, openSite, publish, signIn, type SiteRecord, type TestUser } from './helpers';
import { CONTACT_CENTER_APP_ID, CONTACT_CENTER_KEY } from './platform-fixtures';
import { HONEYPOT_FIELD_NAME } from '../lib/form-spam-settings';

test.describe.configure({ mode: 'serial' });

const RUN = Date.now().toString(36);
const PORT = Number(process.env.E2E_PORT || 3102);
const PLATFORM = `http://127.0.0.1:${Number(process.env.E2E_PLATFORM_PORT || PORT + 3)}`;
const ORG = 'a4a4a4a4-a4a4-4a4a-8a4a-a4a4a4a4a4a4';
const OTHER_ORG = 'a5a5a5a5-a5a5-4a5a-8a5a-a5a5a5a5a5a5';
const MANAGER: TestUser = { sub: 'a6a6a6a6-a6a6-4a6a-8a6a-a6a6a6a6a6a6', email: 'manager-submissions-api@example.com', name: 'Manager Submissions', org: ORG };
/** The defaults of the Member and Viewer profiles (permission-scope.json): read on the forms leaf, nothing more. */
const MEMBER: TestUser = {
  ...MANAGER,
  sub: 'a7a7a7a7-a7a7-4a7a-8a7a-a7a7a7a7a7a7',
  email: 'member-submissions-api@example.com',
  perms: { 'webstudio.manage_content': ['c', 'r', 'u'], 'webstudio.manage_forms': ['r'], 'webstudio.manage_reports': ['r'], 'webstudio.manage_orders': ['r'] },
};
const VIEWER: TestUser = {
  ...MANAGER,
  sub: 'a8a8a8a8-a8a8-4a8a-8a8a-a8a8a8a8a8a8',
  email: 'viewer-submissions-api@example.com',
  perms: { 'webstudio.manage_content': ['r'], 'webstudio.manage_forms': ['r'], 'webstudio.manage_reports': ['r'], 'webstudio.manage_orders': ['r'] },
};
const NO_FORMS: TestUser = { ...MANAGER, sub: 'a9a9a9a9-a9a9-4a9a-8a9a-a9a9a9a9a9a9', email: 'noforms-submissions-api@example.com', perms: { 'webstudio.manage_content': ['r'], 'webstudio.manage_sites': ['r'] } };
const STRANGER: TestUser = { sub: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', email: 'stranger-submissions-api@example.com', name: 'Stranger', org: OTHER_ORG };

/** What a visitor's request leaves in the stored metadata: neither may ever come back from the API. */
const SECRET_AGENT = 'WS-Spec-Agent/9.9 (marker-user-agent)';
const SECRET_IP_PREFIX = '203.0.113.';

/** Seven digits of this run, so the stub's prospects from an earlier run never match. */
const SEVEN = String(Date.now() % 10_000_000).padStart(7, '0');
const typed = (n: number) => `077${n} ${SEVEN.slice(0, 3)} ${SEVEN.slice(3)}`;
const canonical = (n: number) => `96477${n}${SEVEN}`;

interface Layer {
  id: string;
  name: string;
  customName?: string;
  classes?: string | string[];
  attributes?: Record<string, unknown>;
  settings?: Record<string, unknown>;
  variables?: Record<string, unknown>;
  children?: Layer[];
}

interface Row {
  id: string;
  date: string;
  form: { id: string; name: string };
  sender: { name: string | null; phone: string | null };
  unread: boolean;
  contact_center: { state: 'stored' | 'waiting' | 'prospect' | 'contact'; kind: 'prospect' | 'contact' | null; id: string | null };
}
interface Field {
  name: string;
  label: string;
  value: string | string[];
}
interface Detail extends Row {
  fields: Field[];
  links: { open_in_contact_center: string | null };
}
interface Listed {
  data: Row[];
  next_cursor: string | null;
}
interface Counts {
  data: { count: number; sites: Array<{ id: string; count: number }> };
}

let baseURL: string;
let owner: APIRequestContext;
let site: SiteRecord;
let other: SiteRecord;
let db: Knex;
let visitorNumber = 0;
/** Submission ids by name: `ali` (prospect), `noor` (contact), `news` (stored), `huda` (waiting), `omar` (a form no layer holds), `spam`, `press` (the other site). */
const ids: Record<'ali' | 'noor' | 'news' | 'huda' | 'omar' | 'spam' | 'press', string> = { ali: '', noor: '', news: '', huda: '', omar: '', spam: '', press: '' };
let contactCenterId: { prospect: string; contact: string };
let personId: string;

const listUrl = (id = site.id) => `/ycode/api/platform/sites/${id}/submissions`;
const oneUrl = (submission: string, id = site.id) => `${listUrl(id)}/${submission}`;
const formsUrl = (id = site.id) => `${listUrl(id)}/forms`;
const COUNT_URL = '/ycode/api/platform/submissions/unread-count';

function tiptap(text: string) {
  return { type: 'doc', content: [{ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] }] };
}

/** One field as the Form element lays it out: a label wrapper holding the label's text and the input. */
function field(layerId: string, name: string, label: string, tag: 'input' | 'textarea' = 'input'): Layer {
  return {
    id: `${layerId}-group`,
    name: 'div',
    classes: [],
    settings: { tag: 'label' },
    children: [
      { id: `${layerId}-label`, name: 'text', customName: 'Label', classes: [], variables: { text: { type: 'dynamic_rich_text', data: { content: tiptap(label) } } } },
      { id: layerId, name: tag, classes: [], attributes: tag === 'input' ? { type: 'text', name } : { name }, settings: { id: name } },
    ],
  };
}

function formLayer(layerId: string, formId: string, fields: Layer[], customName?: string, createProspect = false): Layer {
  return {
    id: layerId,
    name: 'form',
    ...(customName ? { customName } : {}),
    classes: [],
    settings: { id: formId, ...(createProspect ? { form: { create_prospect: true } } : {}) },
    attributes: { method: 'POST', action: '' },
    children: fields,
  };
}

/** The open site's home page gets exactly these forms, and the site is published. */
async function publishForms(forms: Layer[]): Promise<void> {
  const page = (await draftPages(owner)).find((row) => row.is_index)!;
  const layers = [{ id: 'body', name: 'body', classes: '', children: forms }];
  const response = await owner.put(`/ycode/api/layers?page_id=${page.id}`, { data: { layers } });
  expect(response.status(), await response.text()).toBe(200);
  await publish(owner);
}

/** A visitor's own request to a site's submit route, each from an address of its own (the rate limit counts per address). */
async function submit(target: SiteRecord, formId: string, layerId: string | undefined, payload: Record<string, unknown>): Promise<string> {
  visitorNumber += 1;
  const host = target.hosts[0];
  const api = await request.newContext({
    baseURL,
    userAgent: SECRET_AGENT,
    extraHTTPHeaders: { 'x-forwarded-host': host, origin: `http://${host}`, 'x-forwarded-for': `${SECRET_IP_PREFIX}${visitorNumber}` },
  });
  try {
    const response = await api.post('/studio/api/form-submissions', { data: { form_id: formId, layer_id: layerId, payload } });
    expect(response.status(), await response.text()).toBe(201);
    return (await response.json()).data.id as string;
  } finally {
    await api.dispose();
  }
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

/** Every call this organization's sites have made to the stub Contact Center. */
async function contactCenterCalls(): Promise<Array<{ path: string; response: { id?: string } }>> {
  const context = await request.newContext();
  try {
    const { calls } = (await (await context.get(`${PLATFORM}/__calls?service=contact-center`)).json()) as { calls: Array<{ path: string; entityId: string | null; response: { id?: string } }> };
    return calls.filter((call) => call.entityId === ORG);
  } finally {
    await context.dispose();
  }
}

async function list(api: APIRequestContext = owner, query = '', id = site.id): Promise<Listed> {
  const response = await api.get(`${listUrl(id)}${query}`);
  expect(response.status(), await response.text()).toBe(200);
  return (await response.json()) as Listed;
}
async function detail(submission: string, api: APIRequestContext = owner): Promise<Detail> {
  const response = await api.get(oneUrl(submission));
  expect(response.status(), await response.text()).toBe(200);
  return (await response.json()).data as Detail;
}
async function counts(api: APIRequestContext = owner): Promise<Counts['data']> {
  const response = await api.get(COUNT_URL);
  expect(response.status(), await response.text()).toBe(200);
  return ((await response.json()) as Counts).data;
}
const idsOf = (listed: Listed) => listed.data.map((row) => row.id);
const rowOf = (listed: Listed, id: string): Row => {
  const row = listed.data.find((candidate) => candidate.id === id);
  expect(row, `submission ${id} in the list`).toBeDefined();
  return row!;
};
const siteCount = (data: Counts['data'], id: string) => data.sites.find((entry) => entry.id === id)?.count;

test.beforeAll(async ({ baseURL: configured }) => {
  baseURL = configured!;
  db = knex({ client: 'pg', connection: process.env.DATABASE_URL_TEST });
  owner = await signIn(baseURL, MANAGER);
  site = await createSite(owner, { name: 'Submissions', slug: `submissions-${RUN}`, languages: ['en'], default_language: 'en' });
  other = await createSite(owner, { name: 'Elsewhere', slug: `elsewhere-subs-${RUN}`, languages: ['en'], default_language: 'en' });
  await contactCenterDown(false);

  // The other site first: the builder writes to the site the cookie names.
  expect((await openSite(owner, other.id)).status()).toBe(303);
  await publishForms([formLayer('lyr-press', 'press-form', [field('lyr-press-email', 'email', 'Press email')])]);
  ids.press = await submit(other, 'press-form', 'lyr-press', { email: 'press@example.com' });

  expect((await openSite(owner, site.id)).status()).toBe(303);
  await publishForms([
    // The contact form: a custom name in the layers panel, four fields in this order, and the prospect switch on.
    formLayer(
      'lyr-contact',
      'contact-form',
      [field('lyr-c-name', 'name', 'Full name'), field('lyr-c-phone', 'phone', 'Phone number'), field('lyr-c-email', 'email', 'Email'), field('lyr-c-message', 'message', 'Message', 'textarea')],
      'Contact us',
      true,
    ),
    // A form with no name of its own in the layers panel (it is called by its id) and no name or phone field.
    formLayer('lyr-news', 'newsletter', [field('lyr-n-email', 'email', 'Your email')]),
    // A form nobody has written to yet.
    formLayer('lyr-call', 'callback', [field('lyr-b-phone', 'phone', 'Phone')], 'Request a call'),
  ]);

  // The oldest first: the list shows them newest first.
  ids.ali = await submit(site, 'contact-form', 'lyr-contact', { message: 'Please call me back', name: 'Ali Hassan', phone: typed(1), email: 'ali@example.com', utm_source: 'spring' });

  const contactCenter = await request.newContext({ extraHTTPHeaders: { 'x-service-api-key': CONTACT_CENTER_KEY, 'x-entity-id': ORG } });
  try {
    const made = await contactCenter.post(`${PLATFORM}/api/v1/internal/persons/find-or-create`, { data: { name: 'Noor Kareem', phone: canonical(2), origin: 'storefront' } });
    expect(made.status()).toBe(201);
    personId = (await made.json()).person_id;
  } finally {
    await contactCenter.dispose();
  }
  ids.noor = await submit(site, 'contact-form', 'lyr-contact', { name: 'Noor Kareem', phone: typed(2), email: '', message: 'An order question' });
  ids.news = await submit(site, 'newsletter', 'lyr-news', { email: 'omar@example.com' });
  ids.spam = await submit(site, 'newsletter', 'lyr-news', { email: 'bot@example.com', [HONEYPOT_FIELD_NAME]: 'gotcha' });
  await contactCenterDown(true);
  try {
    ids.huda = await submit(site, 'contact-form', 'lyr-contact', { name: 'Huda Salim', phone: typed(3), message: 'Is anyone there?' });
  } finally {
    await contactCenterDown(false);
  }
  // A form that is not in the site's layers any more, with a name and no phone.
  ids.omar = await submit(site, 'old-form', undefined, { name: 'Omar Khalid' });

  const prospect = (await contactCenterCalls()).find((call) => call.response.id && call.path.endsWith('/prospects/find-or-create'));
  contactCenterId = { prospect: (await db('platform_form_links').where({ submission_id: ids.ali }).first()).contact_center_id, contact: personId };
  expect(prospect?.response.id, 'the stub made the prospect').toBe(contactCenterId.prospect);
});

test.afterAll(async () => {
  await contactCenterDown(false);
  for (const id of [site?.id, other?.id]) {
    if (id) await owner?.delete(`/ycode/api/platform/sites/${id}`);
  }
  await owner?.dispose();
  await db?.destroy();
});

test('lists the site\'s submissions newest first, without spam, with the form, the sender, unread and Contact Center', async () => {
  const listed = await list();
  expect(idsOf(listed)).toEqual([ids.omar, ids.huda, ids.news, ids.noor, ids.ali]);
  expect(listed.next_cursor).toBeNull();
  expect(idsOf(listed)).not.toContain(ids.spam);
  expect(idsOf(listed)).not.toContain(ids.press);

  const ali = rowOf(listed, ids.ali);
  expect(ali).toMatchObject({
    form: { id: 'contact-form', name: 'Contact us' },
    sender: { name: 'Ali Hassan', phone: typed(1) },
    unread: true,
    contact_center: { state: 'prospect', kind: 'prospect', id: contactCenterId.prospect },
  });
  expect(Number.isNaN(Date.parse(ali.date))).toBe(false);
  expect(rowOf(listed, ids.noor).contact_center).toEqual({ state: 'contact', kind: 'contact', id: personId });
  expect(rowOf(listed, ids.news).contact_center).toEqual({ state: 'stored', kind: null, id: null });
  expect(rowOf(listed, ids.huda).contact_center).toEqual({ state: 'waiting', kind: null, id: null });

  // Newest first by the date itself.
  const dates = listed.data.map((row) => Date.parse(row.date));
  expect(dates).toEqual([...dates].sort((a, b) => b - a));
});

test('a form with no name or phone field has null for them, and a form no layer holds is called by its id', async () => {
  const listed = await list();
  // The newsletter has an email field only: the app shows "Not given" for both.
  expect(rowOf(listed, ids.news)).toMatchObject({ form: { id: 'newsletter', name: 'newsletter' }, sender: { name: null, phone: null } });
  // A form that is not in the layers any more keeps its submissions, named by its id; its name is read from the payload.
  expect(rowOf(listed, ids.omar)).toMatchObject({ form: { id: 'old-form', name: 'old-form' }, sender: { name: 'Omar Khalid', phone: null } });
});

test('every row has exactly these keys: no stored IP address, user agent, referrer or payload', async () => {
  const listed = await list();
  for (const row of listed.data) {
    expect(Object.keys(row).sort()).toEqual(['contact_center', 'date', 'form', 'id', 'sender', 'unread']);
    expect(Object.keys(row.contact_center).sort()).toEqual(['id', 'kind', 'state']);
  }
  const text = JSON.stringify(listed);
  expect(text).not.toContain(SECRET_AGENT);
  expect(text).not.toContain(SECRET_IP_PREFIX);
  expect(text).not.toContain('metadata');
});

test('limit and cursor page through the list without a gap or a repeat', async () => {
  const first = await list(owner, '?limit=2');
  expect(idsOf(first)).toEqual([ids.omar, ids.huda]);
  expect(first.next_cursor).toEqual(expect.any(String));

  const second = await list(owner, `?limit=2&cursor=${encodeURIComponent(first.next_cursor!)}`);
  expect(idsOf(second)).toEqual([ids.news, ids.noor]);
  expect(second.next_cursor).toEqual(expect.any(String));

  const third = await list(owner, `?limit=2&cursor=${encodeURIComponent(second.next_cursor!)}`);
  expect(idsOf(third)).toEqual([ids.ali]);
  expect(third.next_cursor).toBeNull();

  // The page of exactly the size left has no next page.
  expect((await list(owner, '?limit=5')).next_cursor).toBeNull();
  expect((await list(owner, '?limit=4')).next_cursor).toEqual(expect.any(String));
});

test('submissions of one form are listed with form_id, and a form with none gives an empty list', async () => {
  expect(idsOf(await list(owner, '?form_id=contact-form'))).toEqual([ids.huda, ids.noor, ids.ali]);
  expect(idsOf(await list(owner, '?form_id=newsletter'))).toEqual([ids.news]);
  expect(idsOf(await list(owner, '?form_id=callback'))).toEqual([]);
  expect(idsOf(await list(owner, '?form_id=nothing-of-the-kind'))).toEqual([]);
  // The paging keeps the filter.
  const first = await list(owner, '?form_id=contact-form&limit=2');
  expect(idsOf(first)).toEqual([ids.huda, ids.noor]);
  expect(idsOf(await list(owner, `?form_id=contact-form&limit=2&cursor=${encodeURIComponent(first.next_cursor!)}`))).toEqual([ids.ali]);
});

test('a query the route does not understand is a 400 that says which part', async () => {
  const bad: Array<[string, RegExp]> = [
    ['?unread=maybe', /unread/],
    ['?limit=0', /limit/],
    ['?limit=101', /limit/],
    ['?limit=ten', /limit/],
    ['?colour=red', /colour/],
    ['?cursor=' + 'x'.repeat(1001), /cursor/],
  ];
  for (const [query, pattern] of bad) {
    const response = await owner.get(`${listUrl()}${query}`);
    expect(response.status(), query).toBe(400);
    expect(JSON.stringify(await response.json()), query).toMatch(pattern);
  }
  const garbled = await owner.get(`${listUrl()}?cursor=not-a-cursor`);
  expect(garbled.status()).toBe(400);
  expect(await garbled.json()).toMatchObject({ code: 'invalid_cursor' });
});

test('the unread count is the organization\'s and each site\'s, spam and other organizations left out', async () => {
  const data = await counts();
  expect(siteCount(data, site.id)).toBe(5);
  expect(siteCount(data, other.id)).toBe(1);
  expect(data.count).toBe(6);
  expect(Object.keys(data).sort()).toEqual(['count', 'sites']);

  // Another organization counts its own submissions only.
  const stranger = await signIn(baseURL, STRANGER);
  try {
    expect(await counts(stranger)).toEqual({ count: 0, sites: [] });
  } finally {
    await stranger.dispose();
  }
});

test('the site\'s forms are listed with their names: the layers\' own, then the ids, and a form no layer holds that has submissions', async () => {
  const response = await owner.get(formsUrl());
  expect(response.status(), await response.text()).toBe(200);
  // By name, ignoring case.
  expect((await response.json()).data).toEqual([
    { id: 'contact-form', name: 'Contact us' },
    { id: 'newsletter', name: 'newsletter' },
    { id: 'old-form', name: 'old-form' },
    { id: 'callback', name: 'Request a call' },
  ]);

  // The other site's form is its own.
  const elsewhere = await owner.get(formsUrl(other.id));
  expect((await elsewhere.json()).data).toEqual([{ id: 'press-form', name: 'press-form' }]);
});

test('opening a submission gives every field the visitor sent, in the form\'s order with its labels, and sets it read', async () => {
  const before = await counts();
  expect(rowOf(await list(), ids.ali).unread).toBe(true);

  const opened = await detail(ids.ali);
  expect(opened).toMatchObject({
    id: ids.ali,
    form: { id: 'contact-form', name: 'Contact us' },
    sender: { name: 'Ali Hassan', phone: typed(1) },
    unread: false,
    contact_center: { state: 'prospect', kind: 'prospect', id: contactCenterId.prospect },
  });
  // The payload comes back in no order of its own: the form's order is name, phone, email, message, and what the form
  // does not have (the visitor's `utm_source`) comes last under its own name.
  expect(opened.fields).toEqual([
    { name: 'name', label: 'Full name', value: 'Ali Hassan' },
    { name: 'phone', label: 'Phone number', value: typed(1) },
    { name: 'email', label: 'Email', value: 'ali@example.com' },
    { name: 'message', label: 'Message', value: 'Please call me back' },
    { name: 'utm_source', label: 'utm_source', value: 'spring' },
  ]);

  // It is read now: the list, the filter and the count all say so, and the other submissions are untouched.
  const listed = await list();
  expect(rowOf(listed, ids.ali).unread).toBe(false);
  expect(rowOf(listed, ids.noor).unread).toBe(true);
  expect(idsOf(await list(owner, '?unread=false'))).toEqual([ids.ali]);
  expect(idsOf(await list(owner, '?unread=true'))).toEqual([ids.omar, ids.huda, ids.news, ids.noor]);
  const after = await counts();
  expect(siteCount(after, site.id)).toBe(siteCount(before, site.id)! - 1);
  expect(siteCount(after, other.id)).toBe(siteCount(before, other.id));
  expect(after.count).toBe(before.count - 1);

  // Opening it again changes nothing.
  expect((await detail(ids.ali)).unread).toBe(false);
  expect(await counts()).toEqual(after);
  expect(await db('form_submissions').where({ id: ids.ali }).first()).toMatchObject({ status: 'read' });
});

test('the two filters work together', async () => {
  expect(idsOf(await list(owner, '?form_id=contact-form&unread=true'))).toEqual([ids.huda, ids.noor]);
  expect(idsOf(await list(owner, '?form_id=contact-form&unread=false'))).toEqual([ids.ali]);
  expect(idsOf(await list(owner, '?form_id=newsletter&unread=false'))).toEqual([]);
  expect(idsOf(await list(owner, '?form_id=newsletter&unread=true'))).toEqual([ids.news]);
  const first = await list(owner, '?unread=true&limit=2');
  expect(idsOf(first)).toEqual([ids.omar, ids.huda]);
  expect(idsOf(await list(owner, `?unread=true&limit=2&cursor=${encodeURIComponent(first.next_cursor!)}`))).toEqual([ids.news, ids.noor]);
});

test('the deep link opens the prospect or the contact in Contact Center, and there is none while the submission waits or is only stored', async () => {
  const app = `torch://app/${CONTACT_CENTER_APP_ID}`;
  expect((await detail(ids.ali)).links).toEqual({ open_in_contact_center: `${app}/prospects/${contactCenterId.prospect}` });
  expect((await detail(ids.noor)).links).toEqual({ open_in_contact_center: `${app}/contacts/persons/${personId}` });
  expect((await detail(ids.huda)).links).toEqual({ open_in_contact_center: null });
  expect((await detail(ids.news)).links).toEqual({ open_in_contact_center: null });
});

test('a submission opened by a Viewer is read too, and the detail never carries the stored IP address or user agent', async () => {
  const viewer = await signIn(baseURL, VIEWER);
  try {
    const opened = await detail(ids.omar, viewer);
    expect(opened.unread).toBe(false);
    expect(opened.fields).toEqual([{ name: 'name', label: 'name', value: 'Omar Khalid' }]);
    expect(Object.keys(opened).sort()).toEqual(['contact_center', 'date', 'fields', 'form', 'id', 'links', 'sender', 'unread']);
  } finally {
    await viewer.dispose();
  }
  for (const id of [ids.ali, ids.noor, ids.news, ids.huda, ids.omar]) {
    const text = JSON.stringify(await detail(id));
    expect(text, id).not.toContain(SECRET_AGENT);
    expect(text, id).not.toContain(SECRET_IP_PREFIX);
    expect(text, id).not.toContain('metadata');
  }
  // The stored metadata is there (so the test could fail): the visitor's address and agent.
  const stored = await db('form_submissions').where({ id: ids.ali }).first();
  expect(stored.metadata.ip).toContain(SECRET_IP_PREFIX);
  expect(stored.metadata.user_agent).toBe(SECRET_AGENT);
});

test('a Manager deletes a submission and its link row, and Contact Center is not called', async () => {
  const callsBefore = await contactCenterCalls();
  const before = await counts();
  expect(await db('platform_form_links').where({ submission_id: ids.ali }).first()).toMatchObject({ state: 'prospect' });

  const removed = await owner.delete(oneUrl(ids.ali));
  expect(removed.status(), await removed.text()).toBe(200);
  expect((await removed.json()).data).toEqual({ id: ids.ali });

  expect((await owner.get(oneUrl(ids.ali))).status()).toBe(404);
  expect(idsOf(await list())).not.toContain(ids.ali);
  expect(await db('form_submissions').where({ id: ids.ali }).first()).toBeUndefined();
  expect(await db('platform_form_links').where({ submission_id: ids.ali }).first()).toBeUndefined();
  // Deleting it twice: it is gone.
  expect((await owner.delete(oneUrl(ids.ali))).status()).toBe(404);
  // The prospect is Contact Center's: nothing was asked of it.
  expect(await contactCenterCalls()).toEqual(callsBefore);
  // A read one leaves the count alone; the neighbours stay.
  expect(await counts()).toEqual(before);
  expect(idsOf(await list())).toEqual([ids.omar, ids.huda, ids.news, ids.noor]);

  // An unread one (a new submission: the others have been opened by now) leaves the count lower.
  const fresh = await submit(site, 'newsletter', 'lyr-news', { email: 'fresh@example.com' });
  const withFresh = await counts();
  expect(withFresh.count).toBe(before.count + 1);
  const unread = await owner.delete(oneUrl(fresh));
  expect(unread.status(), await unread.text()).toBe(200);
  expect(await counts()).toEqual(before);
  expect(await db('platform_form_links').where({ submission_id: fresh }).first()).toBeUndefined();
  expect(await contactCenterCalls()).toEqual(callsBefore);
});

test('a Member and a Viewer read the lists and are refused the delete', async () => {
  for (const person of [MEMBER, VIEWER]) {
    const api = await signIn(baseURL, person);
    try {
      expect((await list(api)).data.length).toBeGreaterThan(0);
      expect((await api.get(formsUrl())).status()).toBe(200);
      expect((await api.get(COUNT_URL)).status()).toBe(200);

      const refused = await api.delete(oneUrl(ids.news));
      expect(refused.status(), person.email).toBe(403);
      expect(await refused.json()).toMatchObject({ required: 'webstudio.manage_forms.d' });
    } finally {
      await api.dispose();
    }
  }
  expect(await db('form_submissions').where({ id: ids.news }).first()).toBeDefined();
  expect(await db('platform_form_links').where({ submission_id: ids.news }).first()).toBeDefined();
});

test('without a session it is 401, without the forms leaf 403', async () => {
  const anonymous = await request.newContext({ baseURL });
  const noForms = await signIn(baseURL, NO_FORMS);
  try {
    for (const path of [listUrl(), oneUrl(ids.news), formsUrl(), COUNT_URL]) {
      expect((await anonymous.get(path)).status(), path).toBe(401);
      const refused = await noForms.get(path);
      expect(refused.status(), path).toBe(403);
      expect(await refused.json()).toMatchObject({ required: 'webstudio.manage_forms.r' });
    }
    expect((await anonymous.delete(oneUrl(ids.news))).status()).toBe(401);
    expect((await noForms.delete(oneUrl(ids.news))).status()).toBe(403);
  } finally {
    await anonymous.dispose();
    await noForms.dispose();
  }
});

test('a submission of another site, another organization, or one that is spam or unknown answers 404, and nothing is changed', async () => {
  // A new, unread submission of the site is the target: a wrong site or organization must not read it or delete it.
  const target = await submit(site, 'newsletter', 'lyr-news', { email: 'target@example.com' });

  // Another site of the same organization: neither read nor deleted, in either direction.
  expect((await owner.get(oneUrl(ids.press))).status()).toBe(404);
  expect((await owner.delete(oneUrl(ids.press))).status()).toBe(404);
  expect((await owner.get(oneUrl(target, other.id))).status()).toBe(404);
  expect((await owner.delete(oneUrl(target, other.id))).status()).toBe(404);
  expect(await db('form_submissions').where({ id: ids.press }).first()).toMatchObject({ status: 'new' });
  expect(await db('form_submissions').where({ id: target }).first()).toMatchObject({ status: 'new' });
  expect(idsOf(await list(owner, '', other.id))).toEqual([ids.press]);

  // Another organization: its own site is the only one it can name.
  const stranger = await signIn(baseURL, STRANGER);
  try {
    for (const path of [listUrl(), oneUrl(target), formsUrl()]) expect((await stranger.get(path)).status(), path).toBe(404);
    expect((await stranger.delete(oneUrl(target))).status()).toBe(404);
    const strangerSite = await createSite(stranger, { name: 'Stranger site', slug: `stranger-subs-${RUN}`, languages: ['en'], default_language: 'en' });
    try {
      expect((await stranger.get(oneUrl(target, strangerSite.id))).status()).toBe(404);
      expect((await stranger.delete(oneUrl(target, strangerSite.id))).status()).toBe(404);
      expect(await list(stranger, '', strangerSite.id)).toEqual({ data: [], next_cursor: null });
    } finally {
      await stranger.delete(`/ycode/api/platform/sites/${strangerSite.id}`);
    }
  } finally {
    await stranger.dispose();
  }
  // Still unread, still there.
  expect(rowOf(await list(), target).unread).toBe(true);
  expect(await db('form_submissions').where({ id: target }).first()).toMatchObject({ status: 'new' });

  // Spam is not a submission of the app: it is not found, and stays for review.
  expect((await owner.get(oneUrl(ids.spam))).status()).toBe(404);
  expect((await owner.delete(oneUrl(ids.spam))).status()).toBe(404);
  expect(await db('form_submissions').where({ id: ids.spam }).first()).toMatchObject({ status: 'spam' });

  // Unknown and malformed ids, for the site and for the submission.
  expect((await owner.get(oneUrl('7d7d7d7d-7d7d-4d7d-8d7d-7d7d7d7d7d7d'))).status()).toBe(404);
  expect((await owner.delete(oneUrl('7d7d7d7d-7d7d-4d7d-8d7d-7d7d7d7d7d7d'))).status()).toBe(404);
  expect((await owner.get(oneUrl('not-an-id'))).status()).toBe(404);
  expect((await owner.get(listUrl('not-an-id'))).status()).toBe(404);
  expect((await owner.get(listUrl('7d7d7d7d-7d7d-4d7d-8d7d-7d7d7d7d7d7d'))).status()).toBe(404);
});

test('deleting a submission is not an edit of the site: another editor\'s lock does not stop it', async () => {
  // The owner holds the site's editor lock (it has just written to the site); a second Manager has the site open.
  expect((await owner.post('/ycode/api/platform/site-lock')).status()).toBe(200);
  const second = await signIn(baseURL, { ...MANAGER, sub: 'abababab-abab-4bab-8bab-abababababab', email: 'second-submissions-api@example.com', name: 'Second Manager' });
  try {
    expect((await openSite(second, site.id)).status()).toBe(303);
    // The lock is held: the builder's own writes are refused for the second Manager...
    const refused = await second.put('/ycode/api/settings/site_name', { data: { value: 'Second was here' } });
    expect(refused.status()).toBe(423);
    // ...and the app's read and delete are not edits.
    const fresh = await submit(site, 'newsletter', 'lyr-news', { email: 'locked@example.com' });
    expect((await second.get(oneUrl(fresh))).status()).toBe(200);
    const removed = await second.delete(oneUrl(fresh));
    expect(removed.status(), await removed.text()).toBe(200);
    expect(await db('form_submissions').where({ id: fresh }).first()).toBeUndefined();
  } finally {
    await second.dispose();
  }
});

test('a deleted site\'s submissions are not counted', async () => {
  const before = await counts();
  expect(siteCount(before, other.id)).toBe(1);
  expect((await owner.delete(`/ycode/api/platform/sites/${other.id}`)).status()).toBe(200);
  const after = await counts();
  expect(siteCount(after, other.id)).toBeUndefined();
  expect(after.count).toBe(before.count - 1);
  expect((await owner.get(listUrl(other.id))).status()).toBe(404);
});
