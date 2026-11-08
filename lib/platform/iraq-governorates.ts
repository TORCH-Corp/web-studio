/**
 * The cities a storefront delivers to: Iraq's governorates, in Arabic and
 * English (part 2, session W3; PRD V1.1 "Cart and checkout").
 *
 * Nineteen, in the checkout design's order (`handoff/store/*\/checkout-form-*.html`)
 * with Halabja after Sulaymaniyah: the design and the session plan list
 * eighteen, and Halabja became the nineteenth governorate by law (Council of
 * Representatives, 14 Apr 2025; Iraqi Gazette, 5 May 2025). Owner, 8 Nov 2026,
 * W3 grill-me (OPEN_QUESTIONS 27).
 *
 * The checkout body names a governorate by its `code`; the Sales order's
 * delivery address carries its name in the language the buyer checked out in
 * (OPEN_QUESTIONS 32). The checkout element (W6) draws its select from this
 * list. Kept free of imports so the page and `node --test` can load it.
 */

export interface Governorate {
  /** Stable; what the checkout body sends. */
  code: string;
  en: string;
  ar: string;
}

export const IRAQ_GOVERNORATES: readonly Governorate[] = [
  { code: 'baghdad', en: 'Baghdad', ar: 'بغداد' },
  { code: 'basra', en: 'Basra', ar: 'البصرة' },
  { code: 'nineveh', en: 'Nineveh', ar: 'نينوى' },
  { code: 'erbil', en: 'Erbil', ar: 'أربيل' },
  { code: 'najaf', en: 'Najaf', ar: 'النجف' },
  { code: 'karbala', en: 'Karbala', ar: 'كربلاء' },
  { code: 'babil', en: 'Babil', ar: 'بابل' },
  { code: 'diyala', en: 'Diyala', ar: 'ديالى' },
  { code: 'sulaymaniyah', en: 'Sulaymaniyah', ar: 'السليمانية' },
  { code: 'halabja', en: 'Halabja', ar: 'حلبجة' },
  { code: 'duhok', en: 'Duhok', ar: 'دهوك' },
  { code: 'kirkuk', en: 'Kirkuk', ar: 'كركوك' },
  { code: 'anbar', en: 'Anbar', ar: 'الأنبار' },
  { code: 'wasit', en: 'Wasit', ar: 'واسط' },
  { code: 'maysan', en: 'Maysan', ar: 'ميسان' },
  { code: 'dhi_qar', en: 'Dhi Qar', ar: 'ذي قار' },
  { code: 'muthanna', en: 'Muthanna', ar: 'المثنى' },
  { code: 'qadisiyyah', en: 'Qadisiyyah', ar: 'القادسية' },
  { code: 'salah_al_din', en: 'Salah al-Din', ar: 'صلاح الدين' },
];

const BY_CODE = new Map(IRAQ_GOVERNORATES.map((governorate) => [governorate.code, governorate]));

/** The governorate with this code; undefined for anything else. */
export function governorateByCode(code: string): Governorate | undefined {
  return BY_CODE.get(code);
}
