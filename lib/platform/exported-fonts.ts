/**
 * An exported static site's Google fonts from the platform's font mirror (part 3, session W10; OPEN_QUESTIONS 63
 * of features/storefront-and-cart), as a published page takes them since part 2's session 26: never from
 * fonts.googleapis.com or fonts.gstatic.com.
 *
 * A published page points its font files at a route of the platform. An exported site has no platform behind it, so
 * the export carries the files itself: `exportedGoogleFonts` returns the @font-face rules, their files at the export's
 * own folder (published-fonts-url.ts), and the files' bytes for the writers to put there.
 */

import { getMirroredCss, getMirroredFontFile } from '@/lib/platform/font-mirror';
import { exportedFontKey, googleCssQuery, mirroredFilePaths, toExportedFontCss } from '@/lib/platform/published-fonts-url';

export interface ExportedFontFile {
  /** Where the export keeps the file (`studio/fonts/inter/v18/….woff2`), the path its rule names. */
  key: string;
  body: Buffer;
}

export interface ExportedGoogleFonts {
  /** The families' @font-face rules, their files root-relative at the export's own folder. */
  css: string;
  files: ExportedFontFile[];
  /** A stylesheet the mirror could not give (it is not asked of Google instead): its address and why. The family has no rule and no file. */
  unavailable: Array<{ url: string; reason: string }>;
}

/**
 * The given Google Fonts stylesheets (`https://fonts.googleapis.com/css2?...`, as lib/font-utils.ts builds them from
 * a site's fonts) from the mirror. A family whose stylesheet or any of its files cannot be read is left out whole, so
 * no rule names a file the export does not carry.
 */
export async function exportedGoogleFonts(googleCssUrls: string[]): Promise<ExportedGoogleFonts> {
  const blocks: string[] = [];
  const files = new Map<string, Buffer>();
  const unavailable: ExportedGoogleFonts['unavailable'] = [];

  for (const url of googleCssUrls) {
    try {
      const query = googleCssQuery(url);
      if (!query) throw new Error('Not a Google Fonts stylesheet');
      const css = await getMirroredCss(query);
      const family = new Map<string, Buffer>();
      for (const filePath of mirroredFilePaths(css)) family.set(exportedFontKey(filePath), await getMirroredFontFile(filePath));
      blocks.push(toExportedFontCss(css));
      for (const [key, body] of family) files.set(key, body);
    } catch (error) {
      unavailable.push({ url, reason: error instanceof Error ? error.message : String(error) });
    }
  }

  return { css: blocks.join('\n'), files: Array.from(files, ([key, body]) => ({ key, body })), unavailable };
}
