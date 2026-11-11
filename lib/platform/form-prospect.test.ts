import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  RETRY_BASE_SECONDS,
  RETRY_CEILING_SECONDS,
  createsProspect,
  firstLinkState,
  linkFromAnswer,
  missingProspectFields,
  parseProspectFields,
  refusedDraftsChange,
  refusedProspectChange,
  retryDelaySeconds,
  switchIsOn,
  type FormRuleLayer,
} from './form-prospect';

/** An input; `required` is the attribute's value, 'absent' for no attribute (the builder removes it when unchecked). */
const input = (name: string, required: unknown = true, id = `in-${name}`): FormRuleLayer => ({
  id,
  name: 'input',
  attributes: required === 'absent' ? { name } : { name, required },
});
const label = (child: FormRuleLayer): FormRuleLayer => ({ id: `wrap-${child.id}`, name: 'div', children: [child] });
const form = (on: boolean, children: FormRuleLayer[], id = 'form-1', formType?: string): FormRuleLayer => ({
  id,
  name: 'form',
  settings: { form: { create_prospect: on, form_type: formType } },
  children,
});
const page = (...layers: FormRuleLayer[]): FormRuleLayer[] => [{ id: 'body', name: 'body', children: layers }];

const BOTH = [label(input('name')), label(input('phone')), label(input('email'))];
const CONTACT = '1b1b1b1b-1b1b-4b1b-8b1b-1b1b1b1b1b1b';

// --- the four states -------------------------------------------------------

test('a submission of a form with the switch off is stored and Contact Center is not asked', () => {
  assert.equal(firstLinkState({ spam: false, switchOn: false }), 'stored');
});

test('spam is stored whatever the switch says', () => {
  assert.equal(firstLinkState({ spam: true, switchOn: true }), 'stored');
  assert.equal(firstLinkState({ spam: true, switchOn: false }), 'stored');
});

test('a real submission of a form with the switch on waits until Contact Center answers', () => {
  assert.equal(firstLinkState({ spam: false, switchOn: true }), 'waiting');
});

test('the answer makes a waiting link a prospect or a contact, with the record', () => {
  assert.deepEqual(linkFromAnswer({ kind: 'prospect', id: CONTACT }), { state: 'prospect', recordId: CONTACT });
  assert.deepEqual(linkFromAnswer({ kind: 'contact', id: CONTACT }), { state: 'contact', recordId: CONTACT });
});

test('the delay between attempts doubles from the base and stops at the ceiling', () => {
  assert.deepEqual([1, 2, 3, 4].map((attempts) => retryDelaySeconds(attempts)), [60, 120, 240, 480]);
  assert.equal(retryDelaySeconds(0), RETRY_BASE_SECONDS);
  assert.equal(retryDelaySeconds(10), RETRY_CEILING_SECONDS);
  assert.equal(retryDelaySeconds(5000), RETRY_CEILING_SECONDS);
  for (let attempts = 1; attempts < 40; attempts += 1) assert.ok(retryDelaySeconds(attempts + 1) >= retryDelaySeconds(attempts));
});

// --- the switch ------------------------------------------------------------

test('only a form layer with the switch on creates a prospect; a password form never does', () => {
  assert.equal(createsProspect(form(true, BOTH)), true);
  assert.equal(createsProspect(form(false, BOTH)), false);
  assert.equal(createsProspect({ id: 'f', name: 'form' }), false);
  assert.equal(createsProspect({ ...form(true, BOTH), name: 'div' }), false);
  assert.equal(createsProspect(form(true, BOTH, 'f', 'password_protected')), false);
  assert.equal(createsProspect({ id: 'f', name: 'form', settings: { form: { create_prospect: 'true' as unknown as boolean } } }), false);
});

test('the switch is the published layer the body names; a body that names none cannot switch a form off', () => {
  assert.equal(switchIsOn({ named: true, namedOn: true, anyOn: true }), true);
  // two forms share the form id, the named one is off
  assert.equal(switchIsOn({ named: true, namedOn: false, anyOn: true }), false);
  // the layer id is left out or made up
  assert.equal(switchIsOn({ named: false, namedOn: false, anyOn: true }), true);
  assert.equal(switchIsOn({ named: false, namedOn: false, anyOn: false }), false);
});

// --- the required fields ---------------------------------------------------

test('a form holds its fields when an input named name and one named phone are required, at any depth', () => {
  assert.deepEqual(missingProspectFields(form(true, BOTH)), []);
  assert.deepEqual(missingProspectFields(form(true, [label(label(input('name', 'true'))), input('phone')])), []);
  assert.deepEqual(missingProspectFields(form(true, [label(input('name'))])), ['phone']);
  assert.deepEqual(missingProspectFields(form(true, [])), ['name', 'phone']);
});

test('an optional field, a field of another name or another element is not the field', () => {
  assert.deepEqual(missingProspectFields(form(true, [input('name'), input('phone', 'absent')])), ['phone']);
  assert.deepEqual(missingProspectFields(form(true, [input('name'), input('phone', false)])), ['phone']);
  assert.deepEqual(missingProspectFields(form(true, [input('name'), input('mobile')])), ['phone']);
  assert.deepEqual(missingProspectFields(form(true, [input('name'), { ...input('phone'), name: 'textarea' }])), ['phone']);
});

test('removing a required field, making it optional, renaming it or moving it out is refused, and the reason names it', () => {
  const before = page(form(true, BOTH));
  const refusals = [
    page(form(true, [BOTH[0], BOTH[2]])), // removed
    page(form(true, [BOTH[0], label(input('phone', 'absent')), BOTH[2]])), // optional
    page(form(true, [BOTH[0], label(input('mobile')), BOTH[2]])), // renamed
    page(form(true, [BOTH[0], BOTH[2]]), BOTH[1]), // moved out of the form
  ];
  for (const after of refusals) {
    const reason = refusedProspectChange(before, after);
    assert.match(reason ?? '', /creates a prospect in Contact Center/);
    assert.match(reason ?? '', /"phone"/);
    assert.doesNotMatch(reason ?? '', /"name"/);
  }
  assert.match(refusedProspectChange(before, page(form(true, [BOTH[2]]))) ?? '', /"name" and "phone"/);
});

test('turning the switch on is refused for a form that lacks a field, and allowed once it has both', () => {
  const reason = refusedProspectChange(page(form(false, [label(input('name'))])), page(form(true, [label(input('name'))])));
  assert.match(reason ?? '', /cannot create prospects yet/);
  assert.match(reason ?? '', /"phone"/);
  assert.equal(refusedProspectChange(page(form(false, BOTH)), page(form(true, BOTH))), null);
});

test('with the switch off, or once it is turned off, the fields are free', () => {
  assert.equal(refusedProspectChange(page(form(false, BOTH)), page(form(false, []))), null);
  assert.equal(refusedProspectChange(page(form(true, BOTH)), page(form(false, []))), null);
});

test('other changes to a form that creates a prospect are allowed: another field, an order, the whole form removed', () => {
  const before = page(form(true, BOTH));
  assert.equal(refusedProspectChange(before, page(form(true, [BOTH[0], BOTH[1]]))), null);
  assert.equal(refusedProspectChange(before, page(form(true, [BOTH[2], BOTH[1], BOTH[0]]))), null);
  assert.equal(refusedProspectChange(before, page()), null);
});

test('a form that is new to the tree or was already out of order does not lock the page', () => {
  const broken = form(true, [label(input('name'))]);
  assert.equal(refusedProspectChange(page(), page(broken)), null); // a paste, a page as it loads
  assert.equal(refusedProspectChange(page(broken), page(form(true, []))), null);
  // the other form on the page is still guarded
  assert.match(refusedProspectChange(page(broken, form(true, BOTH, 'form-2')), page(broken, form(true, [], 'form-2'))) ?? '', /"name" and "phone"/);
});

test('the builder drafts: the page whose change breaks a form refuses it; an untouched or new page does not', () => {
  const good = { layers: page(form(true, BOTH)) };
  const bad = { layers: page(form(true, [])) };
  assert.equal(refusedDraftsChange({ a: good }, { a: good }), null);
  assert.equal(refusedDraftsChange({ a: good }, { a: good, b: bad }), null);
  assert.match(refusedDraftsChange({ a: good, b: good }, { a: good, b: bad }) ?? '', /must keep a required field/);
});

// --- the submission's fields ----------------------------------------------

test('a name and an Iraqi mobile make the prospect, the phone in its canonical form, with or without the country code', () => {
  for (const phone of ['0770 123 4567', '+964 770 123 4567', '9647701234567', '00964-770-123-4567', '٠٧٧٠١٢٣٤٥٦٧']) {
    assert.deepEqual(parseProspectFields({ name: '  Ali   Hassan ', phone }, 'en'), { ok: true, value: { name: 'Ali Hassan', phone: '9647701234567' } }, phone);
  }
});

test('the email and the message go along when they are there; an email Contact Center would refuse is left out', () => {
  assert.deepEqual(parseProspectFields({ name: 'Ali', phone: '07701234567', email: ' ali@example.com ', message: ' Call me ' }, 'en'), {
    ok: true,
    value: { name: 'Ali', phone: '9647701234567', email: 'ali@example.com', notes: 'Call me' },
  });
  assert.deepEqual(parseProspectFields({ name: 'Ali', phone: '07701234567', email: 'not an address', message: '' }, 'en'), {
    ok: true,
    value: { name: 'Ali', phone: '9647701234567' },
  });
  const long = parseProspectFields({ name: 'Ali', phone: '07701234567', message: 'م'.repeat(6000) }, 'en');
  assert.equal(long.ok && Array.from(long.value.notes ?? '').length, 5000);
});

test('a missing name, a name too long, or a phone that is not an Iraqi mobile is refused in the page language', () => {
  assert.deepEqual(parseProspectFields({ phone: '07701234567' }, 'en'), { ok: false, fields: { name: 'Enter your name.' } });
  assert.deepEqual(parseProspectFields({ name: ['a', 'b'], phone: '07701234567' }, 'ar'), { ok: false, fields: { name: 'أدخل اسمك.' } });
  const tooLong = parseProspectFields({ name: 'a'.repeat(256), phone: '07701234567' }, 'en');
  assert.match(tooLong.ok ? '' : tooLong.fields.name ?? '', /up to 255 characters/);
  for (const phone of ['', '12345', '+1 202 555 0100', '0160123456', '0770 123 456', 'call me', '0'.repeat(40)]) {
    const parsed = parseProspectFields({ name: 'Ali', phone }, 'en');
    assert.match(parsed.ok ? '' : parsed.fields.phone ?? '', /Iraqi mobile number/, phone);
  }
  const both = parseProspectFields({}, 'ar');
  assert.deepEqual(Object.keys(both.ok ? {} : both.fields), ['name', 'phone']);
});
