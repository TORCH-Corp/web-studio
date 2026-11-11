/**
 * What the Submissions API takes and what it answers (part 3, session W4; PRD
 * V1.0 "Submissions in Web Studio"): the list query and its cursor, the forms
 * the site's layers hold (their names, their fields in order, their labels),
 * a row of the list, a submission's detail and its deep link into Contact
 * Center. Pure: nothing is asked of the database here (lib/platform/submissions.ts
 * does that) and nothing imports Next, so it runs under `node --test`.
 *
 * A submission is `form_submissions`: the form's id (ycode's `form_id`, the form
 * layer's `settings.id`), the payload the visitor's browser sent (field name →
 * text) and a status. The fork has no form name or field label of its own; they
 * are read from the form layer (`formsOfLayers`). What the request left behind
 * (IP address, user agent, referrer, `metadata`) is never read here, so no
 * answer can carry it: a record type without it is the guarantee.
 *
 * The answers use the fork's own snake_case.
 */

export const SUBMISSIONS_DEFAULT_LIMIT = 25;
export const SUBMISSIONS_MAX_LIMIT = 100;
const MAX_CURSOR = 1000;
/** `form_submissions.form_id` is varchar(255). */
const MAX_FORM_ID = 255;

/** What the published page sends as `form_id` for a form layer with no id of its own (components/LayerRendererPublic.tsx). */
export const UNNAMED_FORM_ID = 'unnamed-form';

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A timestamp as `to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')` writes it. */
const CURSOR_AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/;

// ---- the list query ------------------------------------------------------------------------------------------

/** Where the next page starts: after the submission with this date (to the microsecond, as the database holds it) and id. */
export interface SubmissionCursor {
  at: string;
  id: string;
}

export interface SubmissionsQuery {
  /** Only this form's submissions. */
  formId?: string;
  /** true: unread only; false: read only; absent: both. */
  unread?: boolean;
  cursor?: SubmissionCursor;
  limit: number;
}

/** Opaque text for `next_cursor`: safe in a URL, and only this route's own cursors decode (`decodeCursor`). */
export function encodeCursor(cursor: SubmissionCursor): string {
  return Buffer.from(JSON.stringify({ at: cursor.at, id: cursor.id })).toString('base64url');
}

function decodeCursor(text: string): SubmissionCursor | null {
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(text, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).sort().join() !== 'at,id') return null;
  const { at, id } = record;
  if (typeof at !== 'string' || typeof id !== 'string') return null;
  if (!CURSOR_AT.test(at) || Number.isNaN(Date.parse(at)) || !UUID_PATTERN.test(id)) return null;
  return { at, id: id.toLowerCase() };
}

const QUERY_KEYS = new Set(['form_id', 'unread', 'cursor', 'limit']);

export type SubmissionsQueryResult =
  | { query: SubmissionsQuery; errors: null; code: null }
  /** `code` is 'invalid_cursor' when the cursor is not one this route gave (the route says so in its answer). */
  | { query: null; errors: string[]; code: 'invalid_cursor' | null };

/** The query of GET /ycode/api/platform/sites/{id}/submissions; the messages are ready to return in a 400. */
export function parseSubmissionsQuery(params: URLSearchParams): SubmissionsQueryResult {
  const errors: string[] = [];
  let code: 'invalid_cursor' | null = null;
  for (const key of new Set(params.keys())) if (!QUERY_KEYS.has(key)) errors.push(`${key}: is not a parameter of this route`);

  const query: SubmissionsQuery = { limit: SUBMISSIONS_DEFAULT_LIMIT };

  const formId = params.get('form_id')?.trim();
  if (formId) {
    if (formId.length <= MAX_FORM_ID) query.formId = formId;
    else errors.push(`form_id: at most ${MAX_FORM_ID} characters`);
  }

  const unread = params.get('unread');
  if (unread) {
    if (unread === 'true') query.unread = true;
    else if (unread === 'false') query.unread = false;
    else errors.push('unread: true or false');
  }

  const cursor = params.get('cursor');
  if (cursor) {
    if (cursor.length > MAX_CURSOR) {
      errors.push(`cursor: at most ${MAX_CURSOR} characters`);
    } else {
      const decoded = decodeCursor(cursor);
      if (decoded) {
        query.cursor = decoded;
      } else {
        errors.push('cursor: not a cursor this route gave');
        code = 'invalid_cursor';
      }
    }
  }

  const limit = params.get('limit');
  if (limit !== null) {
    const value = /^\d+$/.test(limit) ? Number(limit) : NaN;
    if (Number.isInteger(value) && value >= 1 && value <= SUBMISSIONS_MAX_LIMIT) query.limit = value;
    else errors.push(`limit: a whole number from 1 to ${SUBMISSIONS_MAX_LIMIT}`);
  }

  return errors.length > 0 ? { query: null, errors, code } : { query, errors: null, code: null };
}

// ---- the forms the layers hold -------------------------------------------------------------------------------

/** As much of a layer as the forms' names, fields and labels are read from. */
export interface FormLayer {
  id: string;
  name: string;
  customName?: string;
  attributes?: Record<string, unknown>;
  settings?: { id?: string; tag?: string; form?: { form_type?: string } };
  variables?: { text?: { type?: string; data?: { content?: unknown } } };
  children?: FormLayer[];
}

export interface FormField {
  /** The name the browser sends the value under: the key in the payload. */
  name: string;
  label: string;
}

export interface FormInfo {
  id: string;
  /** The form layer's own name in the builder's layers panel; the form's id when it has none. */
  name: string;
  fields: FormField[];
}

const FIELD_LAYERS = new Set(['input', 'textarea', 'select']);
/** Inputs that send nothing of their own. */
const NOT_FIELDS = new Set(['submit', 'button', 'reset', 'image']);
/** Rich text nodes that sit inside a line; every other node starts a new one. */
const INLINE_NODES = new Set(['text', 'hardBreak', 'dynamicVariable', 'richTextImage']);

const asText = (value: unknown): string | null => (typeof value === 'string' && value.trim() !== '' ? value : null);
const tidy = (value: string) => value.replace(/\s+/g, ' ').trim();

function richText(node: unknown): string {
  if (typeof node !== 'object' || node === null) return '';
  const { type, text, content } = node as { type?: unknown; text?: unknown; content?: unknown };
  if (type === 'text') return typeof text === 'string' ? text : '';
  if (!Array.isArray(content)) return '';
  const inline = content.every((child) => INLINE_NODES.has((child as { type?: string } | null)?.type ?? ''));
  return content.map(richText).join(inline ? '' : ' ');
}

/** The words a text layer shows: its plain text or the text of its rich text, formatting and variables left out. */
function layerText(layer: FormLayer): string {
  const text = layer.variables?.text;
  if (!text) return '';
  if (text.type === 'dynamic_text') return typeof text.data?.content === 'string' ? tidy(text.data.content) : '';
  if (text.type === 'dynamic_rich_text') return tidy(richText(text.data?.content));
  return '';
}

const isField = (layer: FormLayer) => FIELD_LAYERS.has(layer.name) && !NOT_FIELDS.has(String(layer.attributes?.type ?? ''));

/** Everything a label layer says: its own words and its children's, leaving out the inputs it wraps. */
function textInside(layer: FormLayer): string {
  const parts = [layerText(layer)];
  for (const child of layer.children ?? []) if (!FIELD_LAYERS.has(child.name)) parts.push(textInside(child));
  return tidy(parts.filter(Boolean).join(' '));
}

/** What the browser names a field: its name attribute, else its id setting, else its layer id (LayerRendererPublic). */
function fieldName(layer: FormLayer): string {
  return asText(layer.attributes?.name) ?? asText(layer.settings?.id) ?? layer.id;
}

/** The text of every label that names its input with `for`, by the input's id. */
function labelsNaming(layer: FormLayer, into: Map<string, string> = new Map()): Map<string, string> {
  const target = asText(layer.attributes?.for);
  if (layer.settings?.tag === 'label' && target) {
    const words = textInside(layer);
    if (words) into.set(target, words);
  }
  for (const child of layer.children ?? []) labelsNaming(child, into);
  return into;
}

/** A form's fields in the order of its layers, each once, each with the label a person reads beside it. */
function fieldsOf(form: FormLayer): FormField[] {
  const naming = labelsNaming(form);
  const fields: FormField[] = [];
  const seen = new Set<string>();

  const visit = (layer: FormLayer, label: FormLayer | null) => {
    const enclosing = layer.settings?.tag === 'label' ? layer : label;
    if (FIELD_LAYERS.has(layer.name)) {
      if (!isField(layer)) return;
      const name = fieldName(layer);
      if (seen.has(name)) return;
      seen.add(name);
      const named = [asText(layer.settings?.id), asText(layer.attributes?.id)].map((id) => (id ? naming.get(id) : undefined)).find(Boolean);
      fields.push({ name, label: (enclosing && textInside(enclosing)) || named || tidy(asText(layer.attributes?.placeholder) ?? '') || name });
      return;
    }
    for (const child of layer.children ?? []) visit(child, enclosing);
  };
  visit(form, null);
  return fields;
}

function* formLayersIn(layer: FormLayer): Generator<FormLayer> {
  if (layer.name === 'form') {
    yield layer; // a form does not hold another
    return;
  }
  for (const child of layer.children ?? []) yield* formLayersIn(child);
}

/**
 * The forms of a site's layers by form id. `rows` are layers (a page's, a component's, or a form itself) as the
 * site holds them, published or draft: a visitor submitted what was published, so those lead, and a form that was
 * never published is the draft's. Two layers with one id are one form, the way the submit route sees them (it
 * stores the id only): the first layer that has a name names it, and its fields are the first layer's followed by
 * what the others have more. A password form never submits here and is left out.
 */
export function formsOfLayers(rows: Array<{ published: boolean; layer: FormLayer }>): Map<string, FormInfo> {
  const forms = new Map<string, { customName: string | null; fields: FormField[] }>();
  for (const { layer } of [...rows].sort((a, b) => Number(b.published) - Number(a.published))) {
    for (const form of formLayersIn(layer)) {
      if (form.settings?.form?.form_type === 'password_protected') continue;
      const id = asText(form.settings?.id) ?? UNNAMED_FORM_ID;
      const entry = forms.get(id) ?? { customName: null, fields: [] };
      entry.customName ??= asText(form.customName)?.trim() ?? null;
      for (const field of fieldsOf(form)) if (!entry.fields.some((known) => known.name === field.name)) entry.fields.push(field);
      forms.set(id, entry);
    }
  }
  return new Map(Array.from(forms, ([id, entry]) => [id, { id, name: entry.customName ?? id, fields: entry.fields }]));
}

/** The filter's forms: the site's forms and any form that has submissions, by name without regard to case, then by id. */
export function formChoices(forms: Map<string, FormInfo>, submittedIds: string[]): Array<{ id: string; name: string }> {
  const choices = new Map<string, { id: string; name: string }>();
  for (const form of forms.values()) choices.set(form.id, { id: form.id, name: form.name });
  for (const id of submittedIds) if (!choices.has(id)) choices.set(id, { id, name: id });
  const key = (name: string) => name.toLowerCase();
  return Array.from(choices.values()).sort((a, b) => (key(a.name) < key(b.name) ? -1 : key(a.name) > key(b.name) ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

// ---- a submission --------------------------------------------------------------------------------------------

/** A submission as the database holds it, less what the request left behind (the metadata is never selected). */
export interface SubmissionRecord {
  id: string;
  /** ISO text with microseconds, as the database writes it. */
  created_at: string;
  form_id: string;
  payload: unknown;
  /** 'new' is unread; the app is never given 'spam'. */
  status: string;
  /** `platform_form_links.state`; null when the submission has no link row. */
  link_state: string | null;
  link_contact_center_id: string | null;
}

const asObject = (value: unknown): Record<string, unknown> | null => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null);

/** The sender as the list shows it: the payload's name and phone fields, null for what the form does not have. */
export function senderOf(payload: unknown): { name: string | null; phone: string | null } {
  const fields = asObject(payload);
  const pick = (key: string) => {
    const value = fields?.[key];
    return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
  };
  return { name: pick('name'), phone: pick('phone') };
}

export type ContactCenterState = 'stored' | 'waiting' | 'prospect' | 'contact';
const LINK_STATES: readonly string[] = ['stored', 'waiting', 'prospect', 'contact'];

export interface ContactCenterView {
  state: ContactCenterState;
  /** The kind of Contact Center record the submission became; null while it waits or is only stored. */
  kind: 'prospect' | 'contact' | null;
  id: string | null;
}

/** What became of the submission. One with no link row is Web Studio's alone: 'stored'. */
export function contactCenterOf(state: string | null, recordId: string | null): ContactCenterView {
  if (state === null) return { state: 'stored', kind: null, id: null };
  if (!LINK_STATES.includes(state)) throw new Error(`A submission's Contact Center link has the state "${state}", which is none of ${LINK_STATES.join(', ')}`);
  if (state === 'prospect' || state === 'contact') return { state, kind: state, id: recordId };
  return { state: state as ContactCenterState, kind: null, id: null };
}

export interface SubmissionRowView {
  id: string;
  date: string;
  form: { id: string; name: string };
  sender: { name: string | null; phone: string | null };
  unread: boolean;
  contact_center: ContactCenterView;
}

export function submissionRow(record: SubmissionRecord, forms: Map<string, FormInfo>): SubmissionRowView {
  return {
    id: record.id,
    date: new Date(record.created_at).toISOString(),
    form: { id: record.form_id, name: forms.get(record.form_id)?.name ?? record.form_id },
    sender: senderOf(record.payload),
    unread: record.status === 'new',
    contact_center: contactCenterOf(record.link_state, record.link_contact_center_id),
  };
}

export interface FieldView {
  name: string;
  label: string;
  value: string | string[];
}

/** What a visitor's browser can send for a field is text, or several texts; the payload is free JSON all the same. */
function valueOf(raw: unknown): string | string[] {
  const text = (value: unknown) => (typeof value === 'string' ? value : value === null || value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value));
  return Array.isArray(raw) ? raw.map(text) : text(raw);
}

/**
 * Every field the visitor sent: the form's fields in its order with its labels, then what the form does not have
 * (a field removed since, or one the visitor invented) in the payload's own order under its own name. A field of
 * the form that was not sent is not shown.
 */
export function submissionFields(payload: unknown, form: FormInfo | undefined): FieldView[] {
  const sent = asObject(payload);
  if (!sent) return [];
  const known = (form?.fields ?? []).filter((field) => Object.hasOwn(sent, field.name));
  const named = new Set(known.map((field) => field.name));
  const unknown = Object.keys(sent).filter((name) => !named.has(name)).map((name) => ({ name, label: name }));
  return [...known, ...unknown].map((field) => ({ name: field.name, label: field.label, value: valueOf(sent[field.name]) }));
}

export interface SubmissionLinks {
  /** The prospect or the contact in the Contact Center app, as the shell opens it. Null while the submission waits or is only stored, and without CONTACT_CENTER_APP_ID. */
  open_in_contact_center: string | null;
}

/**
 * `torch://app/<catalogue uuid>/<path>`: the shell opens the app by its catalogue id and hands the path to it, the
 * shape the Orders API gives for Sales (lib/platform/orders-view.ts). Contact Center's own routes are
 * `prospects/{id}` and `contacts/persons/{id}`; the contact a web form finds is a person (its find-or-create
 * answers 'contact' for a person who holds the phone).
 */
export function submissionLinks(contactCenter: ContactCenterView, env: Record<string, string | undefined> = process.env): SubmissionLinks {
  const app = env.CONTACT_CENTER_APP_ID?.trim();
  if (!app || !contactCenter.id || contactCenter.kind === null) return { open_in_contact_center: null };
  const path = contactCenter.kind === 'prospect' ? `prospects/${contactCenter.id}` : `contacts/persons/${contactCenter.id}`;
  return { open_in_contact_center: `torch://app/${app}/${path}` };
}

export interface SubmissionDetailView extends SubmissionRowView {
  fields: FieldView[];
  links: SubmissionLinks;
}

export function submissionDetailView(record: SubmissionRecord, forms: Map<string, FormInfo>, env: Record<string, string | undefined> = process.env): SubmissionDetailView {
  const row = submissionRow(record, forms);
  return { ...row, fields: submissionFields(record.payload, forms.get(record.form_id)), links: submissionLinks(row.contact_center, env) };
}
