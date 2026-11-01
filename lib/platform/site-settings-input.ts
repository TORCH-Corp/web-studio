/**
 * The body of `PATCH /ycode/api/platform/sites/{id}/settings` (part 1, session 7).
 *
 * Every field is optional: a PATCH changes what it names. Checked and
 * normalised here so the route and the tests share one definition. Kept free of
 * Next imports so it runs under `node --test`.
 */

import { z } from 'zod';
import { HOST_PATTERN, SITE_LANGUAGES, SLUG_PATTERN } from '@/lib/platform/site-input';

const unique = <T>(values: T[]): T[] => Array.from(new Set(values));

/** An empty string clears the value, as an empty field in the screen does. */
const clearable = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .transform((value) => (value === '' ? null : value));

export const siteSettingsPatchSchema = z
  .object({
    name: z.string().trim().min(1, 'name must not be empty').max(255).optional(),
    slug: z
      .string()
      .trim()
      .toLowerCase()
      .regex(SLUG_PATTERN, 'slug must be lower-case letters, digits and hyphens, 1 to 63 characters, not starting or ending with a hyphen')
      .optional(),
    /** The complete set of languages the site should have afterwards. */
    languages: z.array(z.enum(SITE_LANGUAGES)).min(1, 'at least one language is required').transform(unique).optional(),
    default_language: z.enum(SITE_LANGUAGES).optional(),
    /** The site's custom host; null (or an empty string) removes it. */
    custom_host: z
      .string()
      .trim()
      .toLowerCase()
      .transform((value) => (value === '' ? null : value))
      .nullable()
      .refine((value) => value === null || HOST_PATTERN.test(value), 'custom_host must be a host name such as www.example.com')
      .optional(),
    seo: z
      .object({
        title: clearable(255).optional(),
        description: clearable(1000).optional(),
        /** An asset id of this site; null removes the default share image. */
        image: z.uuid().nullable().optional(),
      })
      .strict()
      .optional(),
    /** The second call that removes languages (and their translations). */
    confirm: z.boolean().optional(),
  })
  .strict()
  .refine((value) => !value.languages || !value.default_language || value.languages.includes(value.default_language), {
    message: 'default_language must be one of languages',
    path: ['default_language'],
  });

export type SiteSettingsPatch = z.infer<typeof siteSettingsPatchSchema>;

/** Parse a request body; the messages are ready to return in a 400. */
export function parseSiteSettingsPatch(body: unknown): { patch: SiteSettingsPatch; errors: null } | { patch: null; errors: string[] } {
  const result = siteSettingsPatchSchema.safeParse(body);
  if (result.success) return { patch: result.data, errors: null };
  const errors = result.error.issues.map((issue) => (issue.path.length ? `${issue.path.join('.')}: ${issue.message}` : issue.message));
  return { patch: null, errors };
}

/** The languages the patch adds and removes, and the default it leaves. */
export interface LanguagePlan {
  add: string[];
  remove: string[];
  /** The default language afterwards. */
  defaultCode: string;
}

/**
 * What a `languages` / `default_language` pair does to the locales a site has.
 * `current` is the draft locales in use. Returns an error message when the
 * request leaves the site without a valid default.
 */
export function planLanguages(
  current: Array<{ code: string; is_default: boolean }>,
  languages: readonly string[] | undefined,
  defaultLanguage: string | undefined,
): LanguagePlan | { error: string } {
  const currentCodes = current.map((locale) => locale.code);
  const currentDefault = current.find((locale) => locale.is_default)?.code;
  const finalCodes = languages ?? currentCodes;
  const defaultCode = defaultLanguage ?? (currentDefault && finalCodes.includes(currentDefault) ? currentDefault : undefined);
  if (!defaultCode) return { error: `default_language is required: the current default (${currentDefault ?? 'none'}) is not among the languages` };
  if (!finalCodes.includes(defaultCode)) return { error: 'default_language must be one of the site\'s languages' };
  return {
    add: finalCodes.filter((code) => !currentCodes.includes(code)),
    remove: currentCodes.filter((code) => !finalCodes.includes(code)),
    defaultCode,
  };
}
