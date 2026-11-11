/**
 * A form that creates a prospect in Contact Center (part 3, session W3; PRD
 * V1.0 "Forms", "Prospects"): the rules, with nothing of Next or the database
 * in them, so they run in the builder, on the published page, in the submit
 * route and under `node --test`.
 *
 * The switch is `settings.form.create_prospect` on the form layer, next to the
 * success action. While it is on, the form holds an input named `name` and an
 * input named `phone`, both required: the builder refuses a change that takes
 * one away (removing it, moving it out, renaming it, making it optional) and a
 * switch-on for a form that lacks one (owner, 11 Nov 2026).
 *
 * What goes to Contact Center is read from the stored submission by the field
 * names: `name`, `phone`, `email` (left out when empty or not an address
 * Contact Center's schema takes: the field is not required, and the submission
 * keeps what was typed) and `message` as the notes (cut at 5000 characters, the
 * size of a prospect's notes). The phone goes in the canonical form checkout
 * sends, so every spelling of one number is one prospect.
 *
 * Every submission has one link (`platform_form_links`) in one of four states:
 *   stored    Web Studio only: the switch is off, or the submission is spam
 *   waiting   the switch is on and Contact Center has not answered yet
 *   prospect  Contact Center answered with a prospect; the link holds its id
 *   contact   the phone is a contact's; the link holds the contact's id
 */

import { canonicalIraqiMobile, checkoutLocale, MESSAGES, type CheckoutLocale } from '@/lib/platform/checkout-input';

export const PROSPECT_NAME_FIELD = 'name';
export const PROSPECT_PHONE_FIELD = 'phone';
const PROSPECT_EMAIL_FIELD = 'email';
const PROSPECT_NOTES_FIELD = 'message';

export type ProspectField = typeof PROSPECT_NAME_FIELD | typeof PROSPECT_PHONE_FIELD;

/** As much of a layer as the rule reads. */
export interface FormRuleLayer {
  id: string;
  name: string;
  attributes?: Record<string, unknown>;
  settings?: { form?: { create_prospect?: boolean; form_type?: string } };
  children?: FormRuleLayer[];
}

/** Whether this form layer sends its submissions to Contact Center. A password form never does. */
export function createsProspect(layer: FormRuleLayer): boolean {
  return layer.name === 'form' && layer.settings?.form?.create_prospect === true && layer.settings.form.form_type !== 'password_protected';
}

const isRequired = (layer: FormRuleLayer) => layer.attributes?.required === true || layer.attributes?.required === 'true';

function holdsRequiredInput(layers: FormRuleLayer[], field: ProspectField): boolean {
  return layers.some(
    (layer) => (layer.name === 'input' && layer.attributes?.name === field && isRequired(layer)) || holdsRequiredInput(layer.children ?? [], field),
  );
}

/** The required fields the form does not hold: an input with that name, marked required. */
export function missingProspectFields(form: FormRuleLayer): ProspectField[] {
  return ([PROSPECT_NAME_FIELD, PROSPECT_PHONE_FIELD] as const).filter((field) => !holdsRequiredInput(form.children ?? [], field));
}

function formsOf(layers: FormRuleLayer[], found = new Map<string, FormRuleLayer>()): Map<string, FormRuleLayer> {
  for (const layer of layers) {
    if (layer.name === 'form') found.set(layer.id, layer);
    formsOf(layer.children ?? [], found);
  }
  return found;
}

const quoted = (fields: ProspectField[]) => fields.map((field) => `"${field}"`).join(' and ');

/**
 * Why a change to a tree of layers is refused, or null when it is not.
 *
 * Refused: a form that was in order (switch off, or on with both fields)
 * and comes out with the switch on and a field missing. A form that was already
 * out of order, or that is new to the tree (a page as it loads, a paste), is let
 * through: refusing every later edit would lock the page, and the submit route
 * refuses such a form's submissions until it is put right.
 */
export function refusedProspectChange(before: FormRuleLayer[], after: FormRuleLayer[]): string | null {
  const broken = Array.from(formsOf(after).values()).filter((form) => createsProspect(form) && missingProspectFields(form).length > 0);
  if (broken.length === 0) return null;
  const earlier = formsOf(before);
  for (const form of broken) {
    const was = earlier.get(form.id);
    if (!was) continue;
    const missing = missingProspectFields(form);
    if (!createsProspect(was)) {
      return `This form cannot create prospects yet: it needs a required field named ${quoted(missing)}. Add ${missing.length > 1 ? 'them' : 'it'}, then turn the switch on.`;
    }
    if (missingProspectFields(was).length === 0) {
      return `This form creates a prospect in Contact Center, so it must keep a required field named ${quoted(missing)}. Turn off "Create a prospect in Contact Center" in the form's settings to change ${missing.length > 1 ? 'them' : 'it'}.`;
    }
  }
  return null;
}

/** A page's draft as the builder's store keeps it. */
interface DraftOfLayers {
  layers: FormRuleLayer[];
}

/** Why a change of the builder's drafts is refused (the first page whose change is), or null. A page new to the drafts is let through. */
export function refusedDraftsChange(before: Record<string, DraftOfLayers | undefined>, after: Record<string, DraftOfLayers | undefined>): string | null {
  if (before === after) return null;
  for (const [pageId, draft] of Object.entries(after)) {
    const was = before[pageId];
    if (!was || !draft || was.layers === draft.layers) continue;
    const reason = refusedProspectChange(was.layers, draft.layers);
    if (reason) return reason;
  }
  return null;
}

// ---------------------------------------------------------------------------
// The submission's fields
// ---------------------------------------------------------------------------

/** Contact Center's limits (`internal-prospects.schema.ts`): characters, as its schema counts them. */
const NAME_MAX = 255;
const EMAIL_MAX = 255;
const NOTES_MAX = 5000;
/** The typed phone is kept short of anything a number can be; checkout's limit. */
const PHONE_TYPED_MAX = 32;

/** The pattern of the `email` format Contact Center's schema checks with (ajv-formats). */
const EMAIL = /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i;

const NAME_MESSAGES: Record<CheckoutLocale, { name: string; nameTooLong: string }> = {
  en: { name: 'Enter your name.', nameTooLong: `Enter a name of up to ${NAME_MAX} characters.` },
  ar: { name: 'أدخل اسمك.', nameTooLong: `أدخل اسمًا لا يزيد على ${NAME_MAX} حرفًا.` },
};

/** The message under a field that breaks a rule, in the page's language; the phone's is checkout's. */
export function prospectFieldMessage(field: ProspectField | 'nameTooLong', locale: CheckoutLocale): string {
  if (field === PROSPECT_PHONE_FIELD) return MESSAGES[locale].phone;
  return NAME_MESSAGES[locale][field];
}

/** The page's language as the body names it, the site's default otherwise (English when that is neither Arabic nor English). */
export const prospectLocale = checkoutLocale;

/** What Contact Center is asked with. */
export interface ProspectInput {
  name: string;
  /** 964 and the ten national digits. */
  phone: string;
  email?: string;
  notes?: string;
}

export type ProspectParse = { ok: true; value: ProspectInput } | { ok: false; fields: Partial<Record<ProspectField, string>> };

const characters = (text: string) => Array.from(text);
const textOf = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

/** The prospect a submission's fields make, or the message for each required field that breaks its rule. */
export function parseProspectFields(payload: Record<string, unknown>, locale: CheckoutLocale): ProspectParse {
  const fields: Partial<Record<ProspectField, string>> = {};

  const name = textOf(payload[PROSPECT_NAME_FIELD]).replace(/\s+/g, ' ');
  if (!name) fields.name = prospectFieldMessage('name', locale);
  else if (characters(name).length > NAME_MAX) fields.name = prospectFieldMessage('nameTooLong', locale);

  const typed = textOf(payload[PROSPECT_PHONE_FIELD]);
  const phone = characters(typed).length <= PHONE_TYPED_MAX ? canonicalIraqiMobile(typed) : null;
  if (!phone) fields.phone = prospectFieldMessage('phone', locale);

  if (!phone || Object.keys(fields).length > 0) return { ok: false, fields };

  const value: ProspectInput = { name, phone };
  const email = textOf(payload[PROSPECT_EMAIL_FIELD]);
  if (email && characters(email).length <= EMAIL_MAX && EMAIL.test(email)) value.email = email;
  const notes = textOf(payload[PROSPECT_NOTES_FIELD]);
  if (notes) value.notes = characters(notes).slice(0, NOTES_MAX).join('');
  return { ok: true, value };
}

// ---------------------------------------------------------------------------
// The switch as the published site has it
// ---------------------------------------------------------------------------

/** What the published layers of a site say about the form a submission names. */
export interface PublishedSwitch {
  /** A published form has this layer id and this form id. */
  named: boolean;
  /** That form has the switch on. */
  namedOn: boolean;
  /** Some published form with this form id has the switch on. */
  anyOn: boolean;
}

/**
 * Whether the submission's form creates a prospect. The body only names a
 * form; the switch is the published layer's. Form ids are not unique (every
 * Form element starts as "contact-form"), so the layer id tells two forms with
 * one id apart. A body that names no published layer (an old page, a layer
 * inside a collection list or a component, whose id on the page is not the
 * stored one) is read by the form id alone, on when any such form is on: a
 * visitor who leaves the layer out can never switch a form off.
 */
export function switchIsOn(found: PublishedSwitch): boolean {
  return found.named ? found.namedOn : found.anyOn;
}

// ---------------------------------------------------------------------------
// The four states
// ---------------------------------------------------------------------------

export type FormLinkState = 'stored' | 'waiting' | 'prospect' | 'contact';

/** Contact Center's answer to find-or-create. */
export interface ProspectAnswer {
  kind: 'prospect' | 'contact';
  id: string;
}

/** The state a submission's link starts in: Contact Center is asked only for a real submission of a form with the switch on. */
export function firstLinkState(submission: { spam: boolean; switchOn: boolean }): Extract<FormLinkState, 'stored' | 'waiting'> {
  return !submission.spam && submission.switchOn ? 'waiting' : 'stored';
}

/** The state and the record a waiting link takes from Contact Center's answer. */
export function linkFromAnswer(answer: ProspectAnswer): { state: Extract<FormLinkState, 'prospect' | 'contact'>; recordId: string } {
  return { state: answer.kind, recordId: answer.id };
}

/** The delay doubles from the base and stops growing at the ceiling; a waiting link is retried at the ceiling until Contact Center answers (owner, 11 Nov 2026). */
export const RETRY_BASE_SECONDS = 60;
export const RETRY_CEILING_SECONDS = 6 * 60 * 60;

/** Seconds between attempt number `attempts` and the next one. */
export function retryDelaySeconds(attempts: number, baseSeconds: number = RETRY_BASE_SECONDS, ceilingSeconds: number = RETRY_CEILING_SECONDS): number {
  const doublings = Math.min(Math.max(attempts - 1, 0), 30);
  return Math.min(baseSeconds * 2 ** doublings, ceilingSeconds);
}
