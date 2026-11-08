/**
 * The checkout form's values, the body they become, and the route's field
 * errors read back (part 2, session W6; PRD V1.1 "Cart and checkout").
 *
 * The rules live in the route (lib/platform/checkout-input.ts) and nowhere
 * else: the form sends what the buyer typed and shows what the route says
 * under the field it is about, in the page's language (`locale` is sent for
 * that). Nothing is checked twice, so the two cannot disagree.
 *
 * Kept free of Next and React imports so it runs under `node --test`.
 */

import { HONEYPOT_FIELD_NAME } from '@/lib/form-spam-settings';
import type { CartLine } from '@/lib/platform/store-elements/cart-store';
import type { StoreLang } from '@/lib/platform/store-elements/strings';

/** The fields in the order the form has them, which is the order the error summary lists them. */
export const FORM_FIELDS = ['name', 'phone', 'city', 'address', 'landmark', 'notes'] as const;
export type FormField = (typeof FORM_FIELDS)[number];
export type FormValues = Record<FormField, string>;

export const EMPTY_FORM: FormValues = { name: '', phone: '', city: '', address: '', landmark: '', notes: '' };

/** The body of `POST /ycode/api/store/checkout`. */
export interface CheckoutBody {
  checkout_id: string;
  buyer: FormValues;
  lines: Array<{ item_id: string; quantity: string }>;
  locale: StoreLang;
  /** What the form's decoy field held: sent only when something filled it, which only a bot does (the route then answers as a success and creates nothing). */
  [HONEYPOT_FIELD_NAME]?: string;
}

export function checkoutBody(input: { checkoutId: string; values: FormValues; lines: readonly CartLine[]; lang: StoreLang; honeypot?: string }): CheckoutBody {
  return {
    checkout_id: input.checkoutId,
    buyer: { ...input.values },
    lines: input.lines.map((line) => ({ item_id: line.item_id, quantity: String(line.quantity) })),
    locale: input.lang,
    ...(input.honeypot ? { [HONEYPOT_FIELD_NAME]: input.honeypot } : {}),
  };
}

export interface FormErrors {
  /** The route's message for each field it refused. */
  fields: Partial<Record<FormField, string>>;
  /** Messages about the order as a whole (an empty cart, too many items, a checkout id the page lost), once each. */
  general: string[];
}

/** The route's `fields` (keyed `buyer.name`, `lines`, `lines.0.quantity`, `checkout_id`...) sorted into the form's fields and the rest. */
export function formErrors(fields: Record<string, string>): FormErrors {
  const result: FormErrors = { fields: {}, general: [] };
  for (const [path, message] of Object.entries(fields)) {
    const field = path.startsWith('buyer.') ? (path.slice('buyer.'.length) as FormField) : null;
    if (field && (FORM_FIELDS as readonly string[]).includes(field)) result.fields[field] = message;
    else if (!result.general.includes(message)) result.general.push(message);
  }
  return result;
}

/** The fields that have an error, in the form's order. */
export function invalidFields(errors: FormErrors): FormField[] {
  return FORM_FIELDS.filter((field) => errors.fields[field] !== undefined);
}
