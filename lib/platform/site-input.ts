/**
 * What a site is created from (part 1, session 1).
 *
 * The body of `POST /ycode/api/platform/sites`, checked and normalised here so
 * the route and the tests share one definition. Kept free of Next imports so
 * it runs under `node --test`.
 */

import { z } from 'zod';

/** The languages a site can have in part 1 (PRD V1.0 "Sites"). */
export const SITE_LANGUAGES = ['ar', 'en'] as const;
export type SiteLanguage = (typeof SITE_LANGUAGES)[number];

/** One DNS label: the slug becomes `{slug}.sites.torchcorp.com` in session 5. */
export const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** A full host name, lower case, at least two labels. */
export const HOST_PATTERN = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

export const siteInputSchema = z
  .object({
    name: z.string().trim().min(1, 'name is required').max(255),
    slug: z
      .string()
      .trim()
      .toLowerCase()
      .regex(SLUG_PATTERN, 'slug must be lower-case letters, digits and hyphens, 1 to 63 characters, not starting or ending with a hyphen'),
    languages: z.array(z.enum(SITE_LANGUAGES)).min(1, 'at least one language is required').transform(unique),
    default_language: z.enum(SITE_LANGUAGES),
    /** Optional until session 5 adds the default address; a published site answers on these names. */
    hosts: z
      .array(z.string().trim().toLowerCase().regex(HOST_PATTERN, 'hosts must be host names such as example.com'))
      .default([])
      .transform(unique),
    /** Accepted now so the shell can send it; creating from a template is session 4. */
    template_id: z.uuid().optional(),
  })
  .refine((value) => value.languages.includes(value.default_language), {
    message: 'default_language must be one of languages',
    path: ['default_language'],
  });

export type SiteInput = z.infer<typeof siteInputSchema>;

/** Parse a request body; the messages are ready to return in a 400. */
export function parseSiteInput(body: unknown): { input: SiteInput; errors: null } | { input: null; errors: string[] } {
  const result = siteInputSchema.safeParse(body);
  if (result.success) return { input: result.data, errors: null };
  const errors = result.error.issues.map((issue) => (issue.path.length ? `${issue.path.join('.')}: ${issue.message}` : issue.message));
  return { input: null, errors };
}
