/**
 * The body of `POST /ycode/api/store/checkout` and its rules (part 2, session
 * W3; PRD V1.1 "Cart and checkout").
 *
 *   { checkout_id, buyer: { name, phone, city, address, landmark?, notes? },
 *     lines: [{ item_id, quantity }], locale }
 *
 * Two kinds of refusal. A value the buyer typed that breaks a rule is a field
 * error, worded in the page's language for the checkout element to show under
 * its field (`fields`, keyed by the field's path). A body the page could not
 * have sent (not an object, a key nobody reads, a number where text goes) is
 * `invalid_body`, in English, for the developer: unknown keys are refused
 * rather than dropped, so a misnamed field never passes unseen.
 *
 * The rules: name 2 to 120 characters, its first word and the rest each up to
 * 100 (Contact Center's find-or-create refuses a longer part, so the buyer is
 * told here, in the page's language, where it can be corrected: OPEN_QUESTIONS
 * 37); phone an Iraqi mobile number, with or
 * without the country code (OPEN_QUESTIONS 33); city one of
 * lib/platform/iraq-governorates.ts; address 5 to 300; landmark up to 120;
 * notes up to 500; 1 to 50 lines; a quantity above zero with up to four
 * decimals (Sales's QuantityInput: twelve digits before the point). Lengths
 * count characters after trimming. Prices are never read from the body.
 *
 * The honeypot (`ycode_hp`) is screened and removed by the route before this
 * runs. Kept free of Next imports so it runs under `node --test`.
 */

import { governorateByCode, type Governorate } from '@/lib/platform/iraq-governorates';

export type CheckoutLocale = 'ar' | 'en';

export interface CheckoutLine {
  item_id: string;
  /** A decimal string, as Sales takes it. */
  quantity: string;
}

export interface CheckoutBuyer {
  /** Trimmed, inner runs of spaces made one. */
  name: string;
  /** As the buyer typed it, trimmed: the Sales delivery address carries it (OPEN_QUESTIONS 26). */
  phone: string;
  /** The canonical form Contact Center compares: 964 and the ten national digits. */
  phone_canonical: string;
  city: Governorate;
  address: string;
  landmark: string | null;
  notes: string | null;
}

export interface CheckoutInput {
  checkout_id: string;
  /** The page's language: the field errors' and the city name's on the order. */
  locale: CheckoutLocale;
  buyer: CheckoutBuyer;
  lines: CheckoutLine[];
}

export type CheckoutParse =
  | { ok: true; value: CheckoutInput }
  | { ok: false; kind: 'invalid_body'; message: string }
  | { ok: false; kind: 'invalid_checkout'; locale: CheckoutLocale; fields: Record<string, string> };

export const LIMITS = {
  nameMin: 2,
  nameMax: 120,
  /** The first word and the rest after it, each: Contact Center's `NAME_PART_MAX` (Person.firstName and lastName are VARCHAR(100)). */
  namePartMax: 100,
  /** Sales keeps the typed phone in 1 to 32 characters (SL1). */
  phoneMax: 32,
  addressMin: 5,
  addressMax: 300,
  landmarkMax: 120,
  notesMax: 500,
  linesMin: 1,
  linesMax: 50,
} as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Sales's QuantityInput (`common.ts`): above zero, twelve digits before the point, four after. */
const QUANTITY = /^(?!0+(\.0+)?$)[0-9]{1,12}(\.[0-9]{1,4})?$/;

type MessageKey =
  | 'name'
  | 'nameTooLong'
  | 'namePartTooLong'
  | 'phone'
  | 'city'
  | 'address'
  | 'addressTooLong'
  | 'landmarkTooLong'
  | 'notesTooLong'
  | 'emptyCart'
  | 'tooManyLines'
  | 'item'
  | 'quantity'
  | 'checkoutId';

/**
 * The field errors. "Enter your full name." and "Choose your delivery city."
 * are the checkout design's (`checkout-form-validation.html`); the phone's is
 * reworded for decision 16g (with or without the country code); the others are
 * states the design does not draw, worded the same way.
 */
export const MESSAGES: Record<CheckoutLocale, Record<MessageKey, string>> = {
  en: {
    name: 'Enter your full name.',
    nameTooLong: `Enter a name of up to ${LIMITS.nameMax} characters.`,
    namePartTooLong: `Shorten the name: the first word and the rest can each be up to ${LIMITS.namePartMax} characters.`,
    phone: 'Enter an Iraqi mobile number, such as 0770 123 4567 or +964 770 123 4567.',
    city: 'Choose your delivery city.',
    address: 'Enter your delivery address: area, street and house.',
    addressTooLong: `Shorten the address to ${LIMITS.addressMax} characters.`,
    landmarkTooLong: `Shorten the landmark to ${LIMITS.landmarkMax} characters.`,
    notesTooLong: `Shorten the notes to ${LIMITS.notesMax} characters.`,
    emptyCart: 'Your cart is empty.',
    tooManyLines: `An order can hold up to ${LIMITS.linesMax} items. Remove some to place it.`,
    item: 'This item is not in the store.',
    quantity: 'Enter a quantity above zero.',
    checkoutId: 'Reload the page and try again.',
  },
  ar: {
    name: 'أدخل اسمك الكامل.',
    nameTooLong: `أدخل اسمًا لا يزيد على ${LIMITS.nameMax} حرفًا.`,
    namePartTooLong: `اختصر الاسم: لا تزيد الكلمة الأولى ولا بقية الاسم على ${LIMITS.namePartMax} حرف.`,
    phone: 'أدخل رقم هاتف محمول عراقي، مثل 0770 123 4567 أو ‎+964 770 123 4567.',
    city: 'اختر مدينة التوصيل.',
    address: 'أدخل عنوان التوصيل: المنطقة والشارع والدار.',
    addressTooLong: `اختصر العنوان إلى ${LIMITS.addressMax} حرف.`,
    landmarkTooLong: `اختصر أقرب نقطة دالة إلى ${LIMITS.landmarkMax} حرفًا.`,
    notesTooLong: `اختصر الملاحظات إلى ${LIMITS.notesMax} حرف.`,
    emptyCart: 'سلتك فارغة.',
    tooManyLines: `يتسع الطلب لـ ${LIMITS.linesMax} منتجًا على الأكثر. احذف بعضها لإتمام الطلب.`,
    item: 'هذا المنتج غير موجود في المتجر.',
    quantity: 'أدخل كمية أكبر من صفر.',
    checkoutId: 'أعد تحميل الصفحة وحاول مرة أخرى.',
  },
};

/** The page's language, or the site's default when the body names neither Arabic nor English (English when that is neither). */
export function checkoutLocale(value: unknown, siteDefault: string): CheckoutLocale {
  if (value === 'ar' || value === 'en') return value;
  return siteDefault === 'ar' ? 'ar' : 'en';
}

/** Characters, not UTF-16 units. */
const length = (text: string) => Array.from(text).length;

/**
 * Whether the first word or the rest of a name is longer than Contact Center
 * accepts. The split and the count are Contact Center's (`splitFullName`,
 * `find-or-create-person.service.ts`): the first word, and every word after it
 * joined by single spaces, each counted in UTF-16 units (`String.length`), not
 * characters, so a name it would refuse is never one this accepts. `name` is
 * already trimmed with its runs of spaces made one.
 */
function namePartTooLong(name: string): boolean {
  const [first = '', ...rest] = name.split(' ');
  return first.length > LIMITS.namePartMax || rest.join(' ').length > LIMITS.namePartMax;
}

/** Arabic-Indic (٠-٩) and Eastern Arabic-Indic (۰-۹) digits as ASCII digits: a buyer on an Arabic keyboard types them. */
function asciiDigits(text: string): string {
  return text
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

/** Direction marks an Arabic page or keyboard puts around a number. */
const DIRECTION_MARKS = /[؜‎‏‪-‮⁦-⁩]/g;

/**
 * An Iraqi mobile number in the form Contact Center compares (`canonicalPhone`,
 * country code 964): "964" and the ten national digits, the first a 7. Taken
 * with 0 (0770 123 4567), 964, +964 or 00964 before the national digits, with
 * spaces, dots, dashes or brackets between them, in ASCII or Arabic digits.
 * Null for anything else, landlines included (owner, 8 Nov 2026,
 * OPEN_QUESTIONS 33).
 */
export function canonicalIraqiMobile(typed: string): string | null {
  const text = asciiDigits(typed).replace(DIRECTION_MARKS, '').trim();
  if (!/^\+?[0-9\s().-]+$/.test(text)) return null;
  const digits = text.replace(/[^0-9]/g, '');
  let national: string;
  if (text.startsWith('+')) {
    if (!digits.startsWith('964')) return null;
    national = digits.slice(3);
  } else if (digits.startsWith('00964')) {
    national = digits.slice(5);
  } else if (digits.startsWith('964')) {
    national = digits.slice(3);
  } else if (digits.startsWith('0')) {
    national = digits.slice(1);
  } else {
    return null;
  }
  return /^7[0-9]{9}$/.test(national) ? `964${national}` : null;
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

function unknownKey(value: Record<string, unknown>, allowed: readonly string[]): string | null {
  return Object.keys(value).find((key) => !allowed.includes(key)) ?? null;
}

/** The checkout id the body names, lower case; null when it is not a uuid. Read first: a repeat of a stored checkout is answered before the rest is checked. */
export function checkoutIdOf(body: unknown): string | null {
  const id = isObject(body) ? body.checkout_id : undefined;
  return typeof id === 'string' && UUID.test(id) ? id.toLowerCase() : null;
}

const BODY_KEYS = ['checkout_id', 'buyer', 'lines', 'locale'] as const;
const BUYER_KEYS = ['name', 'phone', 'city', 'address', 'landmark', 'notes'] as const;
const LINE_KEYS = ['item_id', 'quantity'] as const;

/** A text field: absent and null read as empty; anything but a string is a body the page could not have sent. */
function text(value: unknown, path: string): { ok: true; value: string } | { ok: false; message: string } {
  if (value === undefined || value === null) return { ok: true, value: '' };
  if (typeof value !== 'string') return { ok: false, message: `${path} must be a string` };
  return { ok: true, value: value.trim() };
}

function quantityOf(value: unknown): string | null {
  const raw = typeof value === 'number' ? (Number.isFinite(value) ? String(value) : '') : typeof value === 'string' ? value.trim() : null;
  return raw !== null && QUANTITY.test(raw) ? raw : null;
}

/** The body, checked. `siteDefault` is the site's default language, for a body that names none. */
export function parseCheckout(body: unknown, siteDefault: string): CheckoutParse {
  const invalid = (message: string): CheckoutParse => ({ ok: false, kind: 'invalid_body', message });
  if (!isObject(body)) return invalid('The body must be a JSON object');
  const extra = unknownKey(body, BODY_KEYS);
  if (extra) return invalid(`Unknown field ${extra}`);
  if (!isObject(body.buyer)) return invalid('buyer must be an object');
  const buyerExtra = unknownKey(body.buyer, BUYER_KEYS);
  if (buyerExtra) return invalid(`Unknown field buyer.${buyerExtra}`);
  if (!Array.isArray(body.lines)) return invalid('lines must be an array');
  if (body.locale !== undefined && typeof body.locale !== 'string') return invalid('locale must be a string');

  const locale = checkoutLocale(body.locale, siteDefault);
  const message = MESSAGES[locale];
  const fields: Record<string, string> = {};

  const texts: Record<(typeof BUYER_KEYS)[number], string> = { name: '', phone: '', city: '', address: '', landmark: '', notes: '' };
  for (const key of BUYER_KEYS) {
    const read = text(body.buyer[key], `buyer.${key}`);
    if (!read.ok) return invalid(read.message);
    texts[key] = read.value;
  }

  const name = texts.name.replace(/\s+/g, ' ');
  if (length(name) < LIMITS.nameMin) fields['buyer.name'] = message.name;
  else if (length(name) > LIMITS.nameMax) fields['buyer.name'] = message.nameTooLong;
  else if (namePartTooLong(name)) fields['buyer.name'] = message.namePartTooLong;

  const canonical = length(texts.phone) <= LIMITS.phoneMax ? canonicalIraqiMobile(texts.phone) : null;
  if (!canonical) fields['buyer.phone'] = message.phone;

  const city = governorateByCode(texts.city);
  if (!city) fields['buyer.city'] = message.city;

  if (length(texts.address) < LIMITS.addressMin) fields['buyer.address'] = message.address;
  else if (length(texts.address) > LIMITS.addressMax) fields['buyer.address'] = message.addressTooLong;
  if (length(texts.landmark) > LIMITS.landmarkMax) fields['buyer.landmark'] = message.landmarkTooLong;
  if (length(texts.notes) > LIMITS.notesMax) fields['buyer.notes'] = message.notesTooLong;

  const checkoutId = checkoutIdOf(body);
  if (!checkoutId) fields.checkout_id = message.checkoutId;

  const lines: CheckoutLine[] = [];
  if (body.lines.length < LIMITS.linesMin) fields.lines = message.emptyCart;
  else if (body.lines.length > LIMITS.linesMax) fields.lines = message.tooManyLines;
  for (const [index, line] of body.lines.entries()) {
    if (!isObject(line)) return invalid(`lines.${index} must be an object`);
    const lineExtra = unknownKey(line, LINE_KEYS);
    if (lineExtra) return invalid(`Unknown field lines.${index}.${lineExtra}`);
    const itemId = typeof line.item_id === 'string' && UUID.test(line.item_id) ? line.item_id.toLowerCase() : null;
    const quantity = quantityOf(line.quantity);
    if (!itemId) fields[`lines.${index}.item_id`] = message.item;
    if (!quantity) fields[`lines.${index}.quantity`] = message.quantity;
    if (itemId && quantity) lines.push({ item_id: itemId, quantity });
  }

  if (Object.keys(fields).length > 0 || !checkoutId || !canonical || !city) {
    return { ok: false, kind: 'invalid_checkout', locale, fields };
  }
  return {
    ok: true,
    value: {
      checkout_id: checkoutId,
      locale,
      buyer: {
        name,
        phone: texts.phone,
        phone_canonical: canonical,
        city,
        address: texts.address,
        landmark: texts.landmark || null,
        notes: texts.notes || null,
      },
      lines,
    },
  };
}
