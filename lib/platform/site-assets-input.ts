/**
 * The query of `GET /ycode/api/platform/sites/{id}/assets` (part 1, session 10).
 *
 * The Tauri app's Site settings screen picks the share image (the default
 * `og:image`) from the site's own images. Checked and normalised here so the
 * route and the tests share one definition. Kept free of Next imports so it
 * runs under `node --test`.
 */

import { z } from 'zod';

/**
 * The image types a share image can be: the ones link previews render. SVG,
 * AVIF, BMP and TIFF are images the builder accepts but crawlers do not show.
 */
export const SHARE_IMAGE_MIME_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];

export const SITE_ASSETS_MAX_LIMIT = 100;

const siteAssetsQuerySchema = z
  .object({
    search: z.string().trim().max(255).optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(SITE_ASSETS_MAX_LIMIT).default(50),
  })
  .strict();

export type SiteAssetsQuery = z.infer<typeof siteAssetsQuerySchema>;

/** Parse the query string; the messages are ready to return in a 400. */
export function parseSiteAssetsQuery(params: URLSearchParams): { query: SiteAssetsQuery; errors: null } | { query: null; errors: string[] } {
  const raw: Record<string, string> = Object.fromEntries(params);
  // A blank search is no search.
  if (raw.search !== undefined && raw.search.trim() === '') delete raw.search;
  const result = siteAssetsQuerySchema.safeParse(raw);
  if (result.success) return { query: result.data, errors: null };
  const errors = result.error.issues.map((issue) => (issue.path.length ? `${issue.path.join('.')}: ${issue.message}` : issue.message));
  return { query: null, errors };
}

/** A search as an ILIKE pattern that matches the text literally: `%`, `_` and `\` are escaped. */
export function containsPattern(search: string): string {
  return `%${search.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}
