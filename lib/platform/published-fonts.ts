/**
 * A published page's Google fonts from the platform's font mirror (part 2,
 * session 26; OPEN_QUESTIONS 60 of features/storefront-and-cart).
 *
 * `publishedGoogleFontsCss` is what the page inlines: each font's stylesheet
 * read through the mirror on the server (font-mirror.ts: fetched from Google
 * once, then kept in the platform storage), with its files pointed at the
 * anonymous route /ycode/api/fonts/published. A visitor's browser never
 * reaches Google.
 *
 * The anonymous route must not hand out whatever the mirror could fetch, so
 * the files a published page's rules name are remembered here, and the route
 * serves those and nothing else. Only a site's own fonts get there: a font is
 * installed by someone who may edit the site, and its rules are made when one
 * of the site's pages is rendered.
 */

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { getMirroredCss } from '@/lib/platform/font-mirror';
import { googleCssQuery, mirroredFilePaths, toPublishedFontCss } from '@/lib/platform/published-fonts-url';
import { STORAGE_DIR } from '@/lib/platform/storage';

/** One empty file per font file a published page names, beside the mirror's own files. */
const REMEMBERED_DIR = path.join(STORAGE_DIR, '_mirror', 'fonts', 'published');
const marker = (filePath: string) => path.join(REMEMBERED_DIR, crypto.createHash('sha256').update(filePath).digest('hex'));

async function rememberFontFiles(filePaths: string[]): Promise<void> {
  await fs.mkdir(REMEMBERED_DIR, { recursive: true });
  await Promise.all(filePaths.map((filePath) => fs.writeFile(marker(filePath), '')));
}

/** Whether a published page's font rules name this file of the mirror (`s/inter/v18/….woff2`). */
export async function isPublishedFontFile(filePath: string): Promise<boolean> {
  try {
    await fs.access(marker(filePath));
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

/**
 * The @font-face rules of the given Google Fonts stylesheets (`https://fonts.googleapis.com/css2?...`, as
 * lib/font-utils.ts builds them from a site's fonts), from the mirror, their files on the site's own host. It
 * throws when the mirror cannot be asked and has no copy: the caller serves the page without the font and says
 * so, and does not send the visitor to Google instead.
 */
export async function publishedGoogleFontsCss(googleCssUrls: string[]): Promise<string> {
  const blocks: string[] = [];
  for (const url of googleCssUrls) {
    const query = googleCssQuery(url);
    if (!query) throw new Error(`Not a Google Fonts stylesheet: ${url}`);
    const css = await getMirroredCss(query);
    await rememberFontFiles(mirroredFilePaths(css));
    blocks.push(toPublishedFontCss(css));
  }
  return blocks.join('\n');
}
