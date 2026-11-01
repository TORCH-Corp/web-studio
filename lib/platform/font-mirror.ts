/**
 * Read-through mirror of Google Fonts in the platform storage (part 1,
 * session 3). The first request for a stylesheet or a font file fetches it
 * from Google on the server; every later one, and every browser, is served
 * from STORAGE_DIR/_mirror/fonts. The builder's browser never reaches Google.
 */

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { STORAGE_DIR } from '@/lib/platform/storage';
import { rewriteGoogleFontCss } from '@/lib/platform/font-mirror-url';

const MIRROR_DIR = path.join(STORAGE_DIR, '_mirror', 'fonts');
const UPSTREAM_TIMEOUT_MS = 10_000;

/** Google varies its CSS by user agent; a modern Chrome gets woff2 with unicode-range subsets. */
const MODERN_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const QUERY = /^[A-Za-z0-9+:;@,.=&_%-]{1,4000}$/;
const FILE_PATH = /^s\/[A-Za-z0-9_-]+(\/[A-Za-z0-9_.-]+)+\.(woff2|woff|ttf)$/;

export class MirrorRequestError extends Error {}

async function readCached(file: string): Promise<Buffer | null> {
  try {
    return await fs.readFile(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

async function store(file: string, data: Buffer): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const partial = `${file}.${process.pid}.${crypto.randomUUID()}.part`;
  await fs.writeFile(partial, data);
  await fs.rename(partial, file);
}

async function fetchUpstream(url: string, headers: Record<string, string> = {}): Promise<Buffer> {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
  if (!response.ok) throw new MirrorRequestError(`Google Fonts answered ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

/** The stylesheet for a css2 query string (`family=Inter:wght@400&display=swap`), font files rewritten to the mirror. */
export async function getMirroredCss(query: string): Promise<string> {
  if (!QUERY.test(query)) throw new MirrorRequestError('Invalid font query');
  const file = path.join(MIRROR_DIR, 'css', `${crypto.createHash('sha256').update(query).digest('hex')}.css`);

  const cached = await readCached(file);
  if (cached) return cached.toString('utf8');

  const upstream = await fetchUpstream(`https://fonts.googleapis.com/css2?${query}`, { 'User-Agent': MODERN_UA });
  const css = rewriteGoogleFontCss(upstream.toString('utf8'));
  await store(file, Buffer.from(css));
  return css;
}

/** A font file at its fonts.gstatic.com path (`s/inter/v18/....woff2`). */
export async function getMirroredFontFile(filePath: string): Promise<Buffer> {
  if (!FILE_PATH.test(filePath)) throw new MirrorRequestError('Invalid font path');
  const file = path.join(MIRROR_DIR, 'files', filePath);

  const cached = await readCached(file);
  if (cached) return cached;

  const data = await fetchUpstream(`https://fonts.gstatic.com/${filePath}`);
  await store(file, data);
  return data;
}
