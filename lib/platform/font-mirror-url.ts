/**
 * Where the builder gets Google Fonts from (part 1, session 3).
 *
 * The builder itself (font picker, canvas, installed-font links) never calls
 * fonts.googleapis.com or fonts.gstatic.com: it asks the app's own mirror,
 * which keeps what it fetched in the platform storage (font-mirror.ts).
 * Published pages use the same mirror through their own anonymous route
 * (published-fonts.ts, part 2, session 26).
 *
 * Pure string functions, safe in the browser.
 */

export const FONT_MIRROR_BASE = '/ycode/api/fonts/mirror';

const GOOGLE_CSS_BASE = 'https://fonts.googleapis.com/css2';
const GSTATIC_FILE = /url\((['"]?)https:\/\/fonts\.gstatic\.com\/(s\/[^)'"\s]+)\1\)/g;

/** A fonts.googleapis.com/css2 URL as the mirror's URL; anything else is returned unchanged. */
export function toMirrorCssUrl(url: string): string {
  return url.startsWith(`${GOOGLE_CSS_BASE}?`) ? `${FONT_MIRROR_BASE}/css2${url.slice(GOOGLE_CSS_BASE.length)}` : url;
}

/** Google's stylesheet with every font file pointed at the mirror. */
export function rewriteGoogleFontCss(css: string): string {
  return css.replace(GSTATIC_FILE, (_match, quote: string, filePath: string) => `url(${quote}${FONT_MIRROR_BASE}/${filePath}${quote})`);
}
