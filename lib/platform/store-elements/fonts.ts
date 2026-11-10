/**
 * IBM Plex Sans Arabic for the store elements, from the platform's font mirror
 * (lib/platform/font-mirror.ts), never from Google (PRD V1.1; part 1 PRD
 * "Builder": fonts come from the platform, not public CDNs).
 *
 * The mirror's own routes are for the signed-in builder. A visitor of a
 * published site needs this one family only, so two anonymous routes under
 * /ycode/api/store/font serve exactly that: the stylesheet, with its files
 * pointed at the second route, and the files of that family. Nothing else the
 * mirror holds is reachable without a session.
 *
 * Kept free of Next imports so it runs under `node --test`.
 */

import { FONT_MIRROR_BASE } from '@/lib/platform/font-mirror-url';

/** The css2 query the stylesheet is read with: the four weights the design system uses. */
export const STORE_FONT_QUERY = 'family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&display=swap';

/** The stylesheet the elements link. */
export const STORE_FONT_CSS_URL = '/studio/api/store/font';

/** Where the stylesheet's font files are served from. */
export const STORE_FONT_FILES_BASE = '/studio/api/store/font/files';

/** The directory Google serves this family under. */
const FAMILY_DIRECTORY = 'ibmplexsansarabic';

/** The mirrored stylesheet with its files pointed at the anonymous route. */
export function toStoreFontCss(mirroredCss: string): string {
  return mirroredCss.split(`${FONT_MIRROR_BASE}/s/`).join(`${STORE_FONT_FILES_BASE}/`);
}

/**
 * The mirror path (`s/ibmplexsansarabic/v12/….woff2`) of a requested font file,
 * or null when the request is for anything but a file of this family.
 */
export function storeFontFilePath(segments: string[]): string | null {
  if (segments.length < 2 || segments[0] !== FAMILY_DIRECTORY) return null;
  return `s/${segments.join('/')}`;
}
