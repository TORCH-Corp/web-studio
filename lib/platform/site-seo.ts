/**
 * A site's default SEO values (part 1, session 7).
 *
 * Stored in ycode's `settings` table, like the favicon (`favicon_asset_id`) and
 * the other site-wide values the published page reads in
 * `fetchGlobalPageSettings`. A page's own SEO value (page settings → SEO)
 * always wins; the default fills the head only where the page has none.
 */

export const SEO_DEFAULT_KEYS = {
  title: 'seo_default_title',
  description: 'seo_default_description',
  /** An asset id. */
  image: 'seo_default_image',
} as const;

/** A stored default as a usable string: settings values come back as JSON, so anything else is "not set". */
export function storedText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

/**
 * A published page's `<title>` (part 3, session W10; part 1's OPEN_QUESTIONS 17, notebook decision 12): what the page
 * says of itself comes first, its SEO title and then its name; the site's name is the last resort before the caller's
 * own fallback ("Home", the slug) and "Page", so a page with neither is titled with the site and not with a guess.
 * A value that is empty or only spaces counts as not set.
 */
export function pageTitle(input: {
  title?: string | null;
  pageName?: string | null;
  siteName?: string | null;
  fallbackTitle?: string;
}): string {
  return storedText(input.title) ?? storedText(input.pageName) ?? storedText(input.siteName) ?? storedText(input.fallbackTitle) ?? 'Page';
}
