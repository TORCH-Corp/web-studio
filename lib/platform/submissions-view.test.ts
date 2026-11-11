import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  contactCenterOf,
  encodeCursor,
  formChoices,
  formsOfLayers,
  parseSubmissionsQuery,
  senderOf,
  submissionDetailView,
  submissionFields,
  submissionLinks,
  submissionRow,
  type FormInfo,
  type FormLayer,
  type SubmissionRecord,
} from './submissions-view';

const q = (search: string) => new URLSearchParams(search);
const ID = '5a5a5a5a-5a5a-4a5a-8a5a-5a5a5a5a5a5a';
const PERSON = '1b1b1b1b-1b1b-4b1b-8b1b-1b1b1b1b1b1b';
const APP = '8e8e8e8e-8e8e-4e8e-8e8e-8e8e8e8e8e8e';
const AT = '2026-11-11T10:20:30.123456Z';

// ---- the list query ------------------------------------------------------------------------------------------

test('the list query: defaults, a form, read or unread, a cursor and a limit', () => {
  assert.deepEqual(parseSubmissionsQuery(q('')), { query: { limit: 25 }, errors: null, code: null });
  assert.deepEqual(parseSubmissionsQuery(q('unread=true&form_id=%20contact-form%20&limit=100')), { query: { unread: true, formId: 'contact-form', limit: 100 }, errors: null, code: null });
  assert.deepEqual(parseSubmissionsQuery(q('unread=false')), { query: { unread: false, limit: 25 }, errors: null, code: null });
  // Empty values are no filter.
  assert.deepEqual(parseSubmissionsQuery(q('form_id=&unread=')), { query: { limit: 25 }, errors: null, code: null });

  const cursor = encodeCursor({ at: AT, id: ID });
  assert.deepEqual(parseSubmissionsQuery(q(`cursor=${cursor}`)), { query: { cursor: { at: AT, id: ID }, limit: 25 }, errors: null, code: null });
  // A cursor is opaque text safe in a URL.
  assert.match(cursor, /^[A-Za-z0-9_-]+$/);
});

test('the list query refuses what it cannot use, naming the parameter', () => {
  for (const [search, field] of [
    ['unread=maybe', 'unread'],
    ['unread=1', 'unread'],
    ['unread=TRUE', 'unread'],
    ['limit=0', 'limit'],
    ['limit=101', 'limit'],
    ['limit=ten', 'limit'],
    ['limit=2.5', 'limit'],
    [`form_id=${'x'.repeat(256)}`, 'form_id'],
    [`cursor=${'x'.repeat(1001)}`, 'cursor'],
    ['site_id=abc', 'site_id'],
  ] as const) {
    const result = parseSubmissionsQuery(q(search));
    assert.equal(result.query, null, search);
    assert.match(result.errors!.join('; '), new RegExp(field), search);
  }
});

test('a cursor that this route did not give is invalid_cursor, whatever it looks like', () => {
  const good = JSON.stringify({ at: AT, id: ID });
  const encode = (text: string) => Buffer.from(text).toString('base64url');
  for (const cursor of [
    'not-a-cursor',
    encode('not json'),
    encode('[]'),
    encode(JSON.stringify({ at: AT })),
    encode(JSON.stringify({ id: ID })),
    encode(JSON.stringify({ at: 'yesterday', id: ID })),
    encode(JSON.stringify({ at: AT, id: 'not-a-uuid' })),
    encode(JSON.stringify({ at: AT, id: ID, extra: 1 })),
    encode(good.replace(AT, "2026-11-11T10:20:30Z'); DROP TABLE form_submissions; --")),
  ]) {
    const result = parseSubmissionsQuery(q(`cursor=${cursor}`));
    assert.equal(result.query, null, cursor);
    assert.equal(result.code, 'invalid_cursor', cursor);
  }
  // A cursor with no fraction of a second is as good as one with six digits.
  assert.equal(parseSubmissionsQuery(q(`cursor=${encodeCursor({ at: '2026-11-11T10:20:30Z', id: ID.toUpperCase() })}`)).errors, null);
  // An uppercase id is the same id.
  assert.deepEqual(parseSubmissionsQuery(q(`cursor=${encodeCursor({ at: AT, id: ID.toUpperCase() })}`)).query?.cursor, { at: AT, id: ID });
});

// ---- the sender and the Contact Center state -----------------------------------------------------------------

test('the sender is the payload\'s name and phone, trimmed; null when it has none, or none that is text', () => {
  assert.deepEqual(senderOf({ name: '  Ali Hassan ', phone: ' 0770 123 4567 ', email: 'ali@example.com' }), { name: 'Ali Hassan', phone: '0770 123 4567' });
  assert.deepEqual(senderOf({ email: 'only@example.com' }), { name: null, phone: null });
  assert.deepEqual(senderOf({ name: '   ', phone: '' }), { name: null, phone: null });
  assert.deepEqual(senderOf({ name: ['Ali', 'Hassan'], phone: 7701234567 }), { name: null, phone: null });
  for (const payload of [null, undefined, 'name', 12, ['name']]) assert.deepEqual(senderOf(payload), { name: null, phone: null });
});

test('the Contact Center marker: state, the kind of record and its id; stored and waiting have none, and a submission with no link is stored', () => {
  assert.deepEqual(contactCenterOf('prospect', ID), { state: 'prospect', kind: 'prospect', id: ID });
  assert.deepEqual(contactCenterOf('contact', PERSON), { state: 'contact', kind: 'contact', id: PERSON });
  assert.deepEqual(contactCenterOf('waiting', null), { state: 'waiting', kind: null, id: null });
  assert.deepEqual(contactCenterOf('stored', null), { state: 'stored', kind: null, id: null });
  assert.deepEqual(contactCenterOf(null, null), { state: 'stored', kind: null, id: null });
  // A record id on a state that has no record is not shown (the table's check forbids it; the view does not trust it).
  assert.deepEqual(contactCenterOf('waiting', ID), { state: 'waiting', kind: null, id: null });
  // A state this code does not know is not a state the app can show.
  assert.throws(() => contactCenterOf('archived', null), /archived/);
});

test('the deep link: the prospect or the contact in Contact Center by its catalogue id, none while waiting or stored, none without the id', () => {
  const env = { CONTACT_CENTER_APP_ID: ` ${APP} ` };
  assert.equal(submissionLinks(contactCenterOf('prospect', ID), env).open_in_contact_center, `torch://app/${APP}/prospects/${ID}`);
  assert.equal(submissionLinks(contactCenterOf('contact', PERSON), env).open_in_contact_center, `torch://app/${APP}/contacts/persons/${PERSON}`);
  assert.equal(submissionLinks(contactCenterOf('waiting', null), env).open_in_contact_center, null);
  assert.equal(submissionLinks(contactCenterOf('stored', null), env).open_in_contact_center, null);
  assert.equal(submissionLinks(contactCenterOf('prospect', ID), {}).open_in_contact_center, null);
  assert.equal(submissionLinks(contactCenterOf('prospect', ID), { CONTACT_CENTER_APP_ID: '  ' }).open_in_contact_center, null);
});

// ---- the forms the layers hold -------------------------------------------------------------------------------

const tiptap = (...paragraphs: string[]) => ({ type: 'doc', content: paragraphs.map((text) => ({ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] })) });
const text = (id: string, content: string): FormLayer => ({ id, name: 'text', variables: { text: { type: 'dynamic_rich_text', data: { content: tiptap(content) } } } });
const input = (id: string, name: string | null, extra: Partial<FormLayer> = {}): FormLayer => ({ id, name: 'input', attributes: { type: 'text', ...(name ? { name } : {}) }, ...extra });
const wrapper = (id: string, ...children: FormLayer[]): FormLayer => ({ id, name: 'div', settings: { tag: 'label' }, children });
const form = (id: string, formId: string | null, children: FormLayer[], extra: Partial<FormLayer> = {}): FormLayer => ({ id, name: 'form', settings: formId ? { id: formId } : {}, children, ...extra });
const one = (layer: FormLayer, published = true) => formsOfLayers([{ published, layer }]);

test('a form\'s fields are its inputs in order, each with the text of the label that wraps it', () => {
  const forms = one(
    form('f1', 'contact-form', [
      { id: 'alert', name: 'div', children: [text('alert-text', 'Something went wrong!')] },
      wrapper('g1', text('t1', 'Full name'), input('i1', 'name')),
      wrapper('g2', text('t2', 'Phone number'), input('i2', 'phone')),
      wrapper('g3', text('t3', 'Message'), { id: 'i3', name: 'textarea', attributes: { name: 'message' } }),
      wrapper('g4', text('t4', 'Country'), { id: 'i4', name: 'select', attributes: { name: 'country' } }),
      { id: 'send', name: 'button', children: [text('send-text', 'Send')] },
    ]),
  );
  assert.deepEqual(forms.get('contact-form'), {
    id: 'contact-form',
    name: 'contact-form',
    fields: [
      { name: 'name', label: 'Full name' },
      { name: 'phone', label: 'Phone number' },
      { name: 'message', label: 'Message' },
      { name: 'country', label: 'Country' },
    ],
  });
});

test('a label can be in the layers any way a builder composes it: rich text with paragraphs, plain text, a label that names its input, the placeholder, then the field name', () => {
  const forms = one(
    form('f1', 'quote', [
      wrapper('g1', text('t1', 'Your'), text('t1b', 'name'), input('i1', 'name')),
      wrapper('g2', text('t2', ''), input('i2', 'company', { attributes: { type: 'text', name: 'company', placeholder: 'Company name' } })),
      wrapper('g3', { id: 't3', name: 'text', variables: { text: { type: 'dynamic_text', data: { content: 'Budget' } } } }, input('i3', 'budget')),
      // A label that is not around the input but names it with `for` (the input's own id setting).
      { id: 'l4', name: 'text', settings: { tag: 'label' }, attributes: { for: 'city-field' }, variables: { text: { type: 'dynamic_rich_text', data: { content: tiptap('City', 'of the site') } } } },
      input('i4', 'city', { settings: { id: 'city-field' } }),
      // Nothing to read: the field's name.
      input('i5', 'notes'),
      // No name attribute: the browser names it by its id setting, then its layer id (LayerRendererPublic).
      input('i6', null, { settings: { id: 'reference' } }),
      input('i7', null),
    ]),
  );
  assert.deepEqual(forms.get('quote')?.fields, [
    { name: 'name', label: 'Your name' },
    { name: 'company', label: 'Company name' },
    { name: 'budget', label: 'Budget' },
    { name: 'city', label: 'City of the site' },
    { name: 'notes', label: 'notes' },
    { name: 'reference', label: 'reference' },
    { name: 'i7', label: 'i7' },
  ]);
});

test('a checkbox is labelled by the text beside it, a button is not a field, and a field is listed once', () => {
  const forms = one(
    form('f1', 'signup', [
      wrapper('g1', input('i1', 'agree', { attributes: { type: 'checkbox', name: 'agree' } }), text('t1', 'I agree to be called')),
      wrapper('g2', text('t2', 'Plan'), input('i2', 'plan', { attributes: { type: 'radio', name: 'plan' } })),
      wrapper('g3', text('t3', 'Plan: yearly'), input('i3', 'plan', { attributes: { type: 'radio', name: 'plan' } })),
      input('i4', 'go', { attributes: { type: 'submit', name: 'go' } }),
      input('i5', 'secret', { attributes: { type: 'hidden', name: 'secret' } }),
    ]),
  );
  assert.deepEqual(forms.get('signup')?.fields, [
    { name: 'agree', label: 'I agree to be called' },
    { name: 'plan', label: 'Plan' },
    { name: 'secret', label: 'secret' },
  ]);
});

test('a form is named by its layer\'s own name, else its id; a form with no id is the one the page sends as unnamed-form', () => {
  const forms = formsOfLayers([
    { published: true, layer: form('f1', 'contact-form', [], { customName: '  Contact us ' }) },
    { published: true, layer: form('f2', 'newsletter', [], { customName: '   ' }) },
    { published: true, layer: form('f3', 'quote', []) },
    { published: true, layer: form('f4', null, []) },
  ]);
  assert.equal(forms.get('contact-form')?.name, 'Contact us');
  assert.equal(forms.get('newsletter')?.name, 'newsletter');
  assert.equal(forms.get('quote')?.name, 'quote');
  assert.equal(forms.get('unnamed-form')?.name, 'unnamed-form');
  assert.equal(forms.size, 4);
});

test('a password form is not a form of the site\'s visitors', () => {
  const password = form('f1', 'password', [wrapper('g1', text('t1', 'Password'), input('i1', 'password'))], { settings: { id: 'password', form: { form_type: 'password_protected' } } });
  assert.equal(one(password).size, 0);
});

test('two forms with one id are one form: the published one names it and leads, the draft adds what it has more', () => {
  const published = form('f1', 'contact-form', [wrapper('g1', text('t1', 'Full name'), input('i1', 'name'))], { customName: 'Contact us' });
  const draft = form('f2', 'contact-form', [wrapper('g1', text('t1', 'Your name'), input('i1', 'name')), wrapper('g2', text('t2', 'Email'), input('i2', 'email'))], { customName: 'Contact (draft)' });
  const merged = formsOfLayers([
    { published: false, layer: draft },
    { published: true, layer: published },
  ]).get('contact-form');
  assert.deepEqual(merged, { id: 'contact-form', name: 'Contact us', fields: [{ name: 'name', label: 'Full name' }, { name: 'email', label: 'Email' }] });

  // A form that was never published is still the draft's.
  assert.equal(formsOfLayers([{ published: false, layer: draft }]).get('contact-form')?.name, 'Contact (draft)');
});

test('a form is found at any depth, in a wrapper or a section', () => {
  const nested = { id: 'body', name: 'body', children: [{ id: 'section', name: 'section', children: [{ id: 'box', name: 'div', children: [form('f1', 'deep-form', [wrapper('g1', text('t1', 'Name'), input('i1', 'name'))])] }] }] } satisfies FormLayer;
  assert.deepEqual(formsOfLayers([{ published: true, layer: nested }]).get('deep-form')?.fields, [{ name: 'name', label: 'Name' }]);
});

// ---- a submission ---------------------------------------------------------------------------------------------

const FORM: FormInfo = {
  id: 'contact-form',
  name: 'Contact us',
  fields: [
    { name: 'name', label: 'Full name' },
    { name: 'phone', label: 'Phone number' },
    { name: 'email', label: 'Email' },
    { name: 'message', label: 'Message' },
  ],
};

test('the fields are in the form\'s order with its labels; what the form lacks follows under its own name, and what was not sent is not shown', () => {
  assert.deepEqual(submissionFields({ message: 'Hi', utm_source: 'spring', name: 'Ali', phone: '0770 123 4567', ref: 'a' }, FORM), [
    { name: 'name', label: 'Full name', value: 'Ali' },
    { name: 'phone', label: 'Phone number', value: '0770 123 4567' },
    { name: 'message', label: 'Message', value: 'Hi' },
    { name: 'utm_source', label: 'utm_source', value: 'spring' },
    { name: 'ref', label: 'ref', value: 'a' },
  ]);
  // A field sent empty was sent: it is shown, empty.
  assert.deepEqual(submissionFields({ name: 'Ali', email: '' }, FORM), [
    { name: 'name', label: 'Full name', value: 'Ali' },
    { name: 'email', label: 'Email', value: '' },
  ]);
});

test('with no form to read, the fields are the payload\'s, each under its own name', () => {
  assert.deepEqual(submissionFields({ name: 'Omar', city: 'Basra' }, undefined), [
    { name: 'name', label: 'name', value: 'Omar' },
    { name: 'city', label: 'city', value: 'Basra' },
  ]);
  for (const payload of [null, undefined, 'text', 4, []]) assert.deepEqual(submissionFields(payload, FORM), []);
});

test('a value is text, or a list of text for a field sent more than once; anything else is made into text', () => {
  assert.deepEqual(submissionFields({ interests: ['a', 'b'], count: 3, agree: true, none: null, nested: { a: 1 }, mixed: ['a', 2, null] }, undefined), [
    { name: 'interests', label: 'interests', value: ['a', 'b'] },
    { name: 'count', label: 'count', value: '3' },
    { name: 'agree', label: 'agree', value: 'true' },
    { name: 'none', label: 'none', value: '' },
    { name: 'nested', label: 'nested', value: '{"a":1}' },
    { name: 'mixed', label: 'mixed', value: ['a', '2', ''] },
  ]);
});

const RECORD: SubmissionRecord = {
  id: ID,
  created_at: '2026-11-11T10:20:30.123456Z',
  form_id: 'contact-form',
  payload: { name: 'Ali Hassan', phone: '0770 123 4567', message: 'Hi' },
  status: 'new',
  link_state: 'prospect',
  link_contact_center_id: PERSON,
};

test('a row of the list: the id, the date, the form, the sender, unread, and Contact Center; nothing else', () => {
  const row = submissionRow(RECORD, new Map([['contact-form', FORM]]));
  assert.deepEqual(row, {
    id: ID,
    date: '2026-11-11T10:20:30.123Z',
    form: { id: 'contact-form', name: 'Contact us' },
    sender: { name: 'Ali Hassan', phone: '0770 123 4567' },
    unread: true,
    contact_center: { state: 'prospect', kind: 'prospect', id: PERSON },
  });
  assert.equal(submissionRow({ ...RECORD, status: 'read' }, new Map()).unread, false);
  // A form no layer holds is called by its id.
  assert.deepEqual(submissionRow(RECORD, new Map()).form, { id: 'contact-form', name: 'contact-form' });
  // Whatever else the record carries (the stored metadata above all) is never copied.
  const loaded = { ...RECORD, metadata: { ip: '203.0.113.9', user_agent: 'Agent/1' } } as SubmissionRecord;
  assert.doesNotMatch(JSON.stringify(submissionRow(loaded, new Map())), /203\.0\.113|Agent/);
  assert.doesNotMatch(JSON.stringify(submissionDetailView(loaded, new Map(), {})), /203\.0\.113|Agent/);
});

test('the detail is the row with every field and the link; reading has made it read', () => {
  const view = submissionDetailView({ ...RECORD, status: 'read' }, new Map([['contact-form', FORM]]), { CONTACT_CENTER_APP_ID: APP });
  assert.deepEqual(Object.keys(view).sort(), ['contact_center', 'date', 'fields', 'form', 'id', 'links', 'sender', 'unread']);
  assert.equal(view.unread, false);
  assert.deepEqual(view.fields, [
    { name: 'name', label: 'Full name', value: 'Ali Hassan' },
    { name: 'phone', label: 'Phone number', value: '0770 123 4567' },
    { name: 'message', label: 'Message', value: 'Hi' },
  ]);
  assert.deepEqual(view.links, { open_in_contact_center: `torch://app/${APP}/prospects/${PERSON}` });
});

// ---- the forms for the filter ---------------------------------------------------------------------------------

test('the filter\'s forms are the site\'s forms and the forms that have submissions, by name without regard to case, then by id', () => {
  const forms = formsOfLayers([
    { published: true, layer: form('f1', 'contact-form', [], { customName: 'Contact us' }) },
    { published: true, layer: form('f2', 'newsletter', []) },
    { published: true, layer: form('f3', 'callback', [], { customName: 'request a call' }) },
    { published: true, layer: form('f4', 'b-form', [], { customName: 'Same' }) },
    { published: true, layer: form('f5', 'a-form', [], { customName: 'same' }) },
  ]);
  assert.deepEqual(formChoices(forms, ['contact-form', 'old-form', 'old-form']), [
    { id: 'contact-form', name: 'Contact us' },
    { id: 'newsletter', name: 'newsletter' },
    { id: 'old-form', name: 'old-form' },
    { id: 'callback', name: 'request a call' },
    { id: 'a-form', name: 'same' },
    { id: 'b-form', name: 'Same' },
  ]);
  assert.deepEqual(formChoices(new Map(), []), []);
});
