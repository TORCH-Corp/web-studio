/**
 * The page's side of a form that creates a prospect (part 3, session W3): the
 * name and the phone are checked before the form is sent, and a refusal of
 * the server's is shown the same way. Called by the two renderers' submit
 * handlers; the rules are lib/platform/form-prospect.ts.
 *
 * The message is the browser's own validation bubble on the field
 * (`setCustomValidity`), in the page's language: the form's design is the
 * site owner's, so nothing is drawn into it. It goes when the visitor types.
 */

import { parseProspectFields, prospectLocale, type ProspectField } from '@/lib/platform/form-prospect';

type FieldMessages = Partial<Record<ProspectField, string>>;

/** The page's language as the server is told it: the page's locale, the document's otherwise. */
export function pageLocale(localeCode: string | null | undefined): string {
  return localeCode || (typeof document !== 'undefined' ? document.documentElement.lang : '') || '';
}

/** Put each message on its field and show the first; false when there was none. */
function show(form: HTMLFormElement, fields: FieldMessages): boolean {
  let first: HTMLInputElement | null = null;
  for (const [name, message] of Object.entries(fields)) {
    const input = Array.from(form.elements).find((element): element is HTMLInputElement => element instanceof HTMLInputElement && element.name === name);
    if (!input || !message) continue;
    input.setCustomValidity(message);
    input.addEventListener('input', () => input.setCustomValidity(''), { once: true });
    first ??= input;
  }
  first?.reportValidity();
  return first !== null;
}

/** Before sending: true when the name and the phone hold; otherwise the messages are shown and the form is not sent. */
export function prospectFieldsHold(form: HTMLFormElement, payload: Record<string, unknown>, localeCode: string | null | undefined): boolean {
  const parsed = parseProspectFields(payload, prospectLocale(pageLocale(localeCode), 'en'));
  if (parsed.ok) return true;
  // A form whose field the page does not hold cannot show its message: the server's answer decides.
  return !show(form, parsed.fields);
}

/** After sending: true when the server refused a field and its message is now on the page. */
export function showRefusedFields(form: HTMLFormElement, status: number, result: unknown): boolean {
  if (status !== 400 || typeof result !== 'object' || result === null) return false;
  const { code, fields } = result as { code?: unknown; fields?: unknown };
  if (code !== 'invalid_fields' || typeof fields !== 'object' || fields === null) return false;
  return show(form, fields as FieldMessages);
}
