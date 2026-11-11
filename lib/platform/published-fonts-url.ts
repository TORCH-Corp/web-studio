/**
 * Where a published page gets its site's Google fonts (part 2, session 26):
 * the platform's font mirror, on the site's own host, never
 * fonts.googleapis.com or fonts.gstatic.com (the fork's rule: no runtime
 * dependency on a public CDN; PRD V1.1 "Platform").
 *
 * The mirror's own routes (font-mirror-url.ts) are for the signed-in builder.
 * A visitor has no session, so a published page's font rules point their files
 * at one anonymous route, which serves only the files such rules name
 * (published-fonts.ts).
 *
 * Pure string functions, kept free of Next and Node imports so they run under
 * `node --test`.
 */

import { FONT_MIRROR_BASE } from '@/lib/platform/font-mirror-url';

/** Where a published page's font files are served from: `{base}/{family}/{version}/{file}`. */
export const PUBLISHED_FONT_FILES_BASE = '/studio/api/fonts/published';

const GOOGLE_CSS_BASE = 'https://fonts.googleapis.com/css2?';
const MIRROR_FILE = new RegExp(`${FONT_MIRROR_BASE}/(s/[^)'"\\s]+)`, 'g');

/** The css2 query (`family=Inter:wght@400;700&display=swap`) of a Google Fonts stylesheet URL; null for any other URL. */
export function googleCssQuery(url: string): string | null {
  return url.startsWith(GOOGLE_CSS_BASE) && url.length > GOOGLE_CSS_BASE.length ? url.slice(GOOGLE_CSS_BASE.length) : null;
}

/** The font files a mirrored stylesheet names, as the mirror keeps them (`s/inter/v18/….woff2`), once each. */
export function mirroredFilePaths(mirroredCss: string): string[] {
  return [...new Set(Array.from(mirroredCss.matchAll(MIRROR_FILE), (match) => match[1]))];
}

/** A mirrored stylesheet with its files pointed at the anonymous route of published pages. */
export function toPublishedFontCss(mirroredCss: string): string {
  return mirroredCss.split(`${FONT_MIRROR_BASE}/s/`).join(`${PUBLISHED_FONT_FILES_BASE}/`);
}

/**
 * Where an exported static site keeps its font files (part 3, W10; OPEN_QUESTIONS 63 of features/storefront-and-cart):
 * a folder of the export itself, `{base}/{family}/{version}/{file}`, beside `studio/layouts/assets`. An exported
 * site has no platform behind it, so the mirror's routes cannot serve it: the export carries the files.
 */
export const EXPORTED_FONT_FILES_BASE = '/studio/fonts';

/**
 * A mirrored stylesheet with its files pointed at the export's own folder, root-relative as a page's own links are:
 * the export makes each of them relative to the page that carries it (lib/apps/static-export/engine.ts).
 */
export function toExportedFontCss(mirroredCss: string): string {
  return mirroredCss.split(`${FONT_MIRROR_BASE}/s/`).join(`${EXPORTED_FONT_FILES_BASE}/`);
}

/** The key a mirrored font file (`s/inter/v18/….woff2`) has in the export, the path `toExportedFontCss` gave its rule. */
export function exportedFontKey(mirrorFilePath: string): string {
  return `${EXPORTED_FONT_FILES_BASE.slice(1)}/${mirrorFilePath.replace(/^s\//, '')}`;
}

/** The mirror path (`s/inter/v18/….woff2`) of a file the anonymous route was asked for: a family, a version and a file at least. */
export function publishedFontFilePath(segments: string[]): string | null {
  return segments.length >= 3 ? `s/${segments.join('/')}` : null;
}
