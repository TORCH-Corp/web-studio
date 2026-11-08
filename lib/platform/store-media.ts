/**
 * The store's item images, kept on disk (part 2, session W2; PRD V1.1
 * "Catalogue"; OQ 1).
 *
 * An item image is a Document Center document of the organization. Document
 * Center logs every download, so an image is fetched once and kept here, keyed
 * by organization, document id and the sha256 of its bytes:
 *
 *   {dir}/{organizationId}/{documentId}/{sha256}        the bytes
 *   {dir}/{organizationId}/{documentId}/current.json    { sha256, contentType, size, fetchedAt, checkedAt }
 *
 * Always on disk, in either storage mode, as the font mirror is (owner, 8 Nov
 * 2026, W2 grill-me): it is a copy of another app's file, not the site's
 * content, so nothing is uploaded to Document Center and nothing appears in the
 * organization's library. A document can get a new version under the same id;
 * once a day at most the copy is checked against the document's current
 * `fileHash` (a read Document Center records as "viewed", never a download)
 * and fetched again only when it changed (owner, same day). A document that is
 * gone is forgotten. While Document Center cannot be asked, the stored copy is
 * served and the check is tried again after ten minutes; the failure is logged.
 *
 * Only raster image types are kept and served: an SVG or HTML document under
 * the site's host could run script in the site's origin. A document refused for
 * its type is remembered until its daily check, so it is not downloaded (and
 * logged) again on every view: Product & Services can be set to take SVG
 * product images.
 *
 * Who may see which image is not decided here: lib/platform/catalogue.ts only
 * asks for an image of a product the site sells. Kept free of Next imports so
 * it runs under `node --test`.
 */

import { createHash } from 'crypto';
import fs from 'fs/promises';
import path from 'path';

export const MEDIA_TYPES: ReadonlySet<string> = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']);
export const RECHECK_MS = 24 * 60 * 60 * 1000;
export const RETRY_MS = 10 * 60 * 1000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/;

export interface MediaMeta {
  sha256: string;
  contentType: string;
  size: number;
  fetchedAt: string;
  /** When the copy was last known to be the document's current version (ms since the epoch). */
  checkedAt: number;
}

export interface MediaFile {
  data: Buffer;
  meta: MediaMeta;
}

/** Where the bytes come from: Document Center, with Web Studio's service key and the organization. */
export interface MediaSource {
  /** The current version's bytes and media type; null when the document is gone. */
  download(organizationId: string, documentId: string): Promise<{ data: Buffer; contentType: string | null } | null>;
  /** The sha256 of the current version; null when the document is gone. */
  currentHash(organizationId: string, documentId: string): Promise<string | null>;
}

/** Document Center could not give an image that is not kept yet. */
export class StoreMediaUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StoreMediaUnavailableError';
  }
}

export interface StoreMediaCache {
  /** The image, from disk when kept; null when it is gone or not an image. */
  get(organizationId: string, documentId: string): Promise<MediaFile | null>;
}

const reason = (error: unknown) => (error instanceof Error ? error.message : String(error));

async function writeAtomically(file: string, data: Buffer | string): Promise<void> {
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temporary, data);
  await fs.rename(temporary, file);
}

export function createStoreMediaCache(options: {
  dir: string;
  source: MediaSource;
  now?: () => number;
  log?: (message: string) => void;
}): StoreMediaCache {
  const { dir, source } = options;
  const now = options.now ?? Date.now;
  const log = options.log ?? ((message: string) => console.error(message));
  const inflight = new Map<string, Promise<MediaFile | null>>();
  const retryAfter = new Map<string, number>();
  /** Documents whose current version is not an image the store serves, until when (ms since the epoch). */
  const refusedUntil = new Map<string, number>();

  const folderOf = (organizationId: string, documentId: string) => path.join(dir, organizationId.toLowerCase(), documentId.toLowerCase());

  async function readStored(folder: string): Promise<MediaFile | null> {
    let meta: MediaMeta;
    try {
      meta = JSON.parse(await fs.readFile(path.join(folder, 'current.json'), 'utf8')) as MediaMeta;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
    if (!SHA256.test(meta.sha256) || !MEDIA_TYPES.has(meta.contentType)) return null;
    const data = await fs.readFile(path.join(folder, meta.sha256)).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    // A copy cut short (a crash between the two writes) is fetched again.
    if (!data || data.length !== meta.size) return null;
    return { data, meta };
  }

  async function keep(folder: string, data: Buffer, contentType: string): Promise<MediaFile> {
    const sha256 = createHash('sha256').update(data).digest('hex');
    await fs.mkdir(folder, { recursive: true });
    await writeAtomically(path.join(folder, sha256), data);
    const meta: MediaMeta = { sha256, contentType, size: data.length, fetchedAt: new Date(now()).toISOString(), checkedAt: now() };
    await writeAtomically(path.join(folder, 'current.json'), JSON.stringify(meta));
    // The versions this one replaces.
    for (const name of await fs.readdir(folder)) {
      if (name !== sha256 && name !== 'current.json' && SHA256.test(name)) await fs.rm(path.join(folder, name), { force: true });
    }
    return { data, meta };
  }

  async function fetchAndKeep(organizationId: string, documentId: string, folder: string, key: string): Promise<MediaFile | null> {
    let file: { data: Buffer; contentType: string | null } | null;
    try {
      file = await source.download(organizationId, documentId);
    } catch (error) {
      throw new StoreMediaUnavailableError(`Document Center could not give image ${documentId}: ${reason(error)}`);
    }
    if (!file) {
      await fs.rm(folder, { recursive: true, force: true });
      return null;
    }
    if (!file.contentType || !MEDIA_TYPES.has(file.contentType)) {
      log(`[store-media] document ${documentId} of organization ${organizationId} is ${file.contentType ?? 'of no stated type'}, not an image the store serves; asked again in a day`);
      refusedUntil.set(key, now() + RECHECK_MS);
      // A copy of an earlier version is not the document any more.
      await fs.rm(folder, { recursive: true, force: true });
      return null;
    }
    return keep(folder, file.data, file.contentType);
  }

  async function load(organizationId: string, documentId: string, key: string): Promise<MediaFile | null> {
    if ((refusedUntil.get(key) ?? 0) > now()) return null;
    refusedUntil.delete(key);
    const folder = folderOf(organizationId, documentId);
    const stored = await readStored(folder);
    if (!stored) return fetchAndKeep(organizationId, documentId, folder, key);
    if (now() - stored.meta.checkedAt < RECHECK_MS || (retryAfter.get(key) ?? 0) > now()) return stored;

    let hash: string | null;
    try {
      hash = await source.currentHash(organizationId, documentId);
    } catch (error) {
      retryAfter.set(key, now() + RETRY_MS);
      log(`[store-media] the daily check of image ${documentId} failed, the stored copy is served and checked again in ten minutes: ${reason(error)}`);
      return stored;
    }
    retryAfter.delete(key);
    if (hash === null) {
      await fs.rm(folder, { recursive: true, force: true });
      return null;
    }
    if (hash === stored.meta.sha256) {
      const meta = { ...stored.meta, checkedAt: now() };
      await writeAtomically(path.join(folder, 'current.json'), JSON.stringify(meta));
      return { data: stored.data, meta };
    }
    try {
      return await fetchAndKeep(organizationId, documentId, folder, key);
    } catch (error) {
      if (!(error instanceof StoreMediaUnavailableError)) throw error;
      retryAfter.set(key, now() + RETRY_MS);
      log(`[store-media] image ${documentId} has a new version that could not be fetched, the stored copy is served meanwhile: ${error.message}`);
      return stored;
    }
  }

  return {
    get(organizationId, documentId) {
      if (!UUID.test(organizationId) || !UUID.test(documentId)) return Promise.reject(new Error('An organization and a document are uuids'));
      const key = `${organizationId.toLowerCase()}/${documentId.toLowerCase()}`;
      const running = inflight.get(key);
      if (running) return running;
      const work = load(organizationId, documentId, key).finally(() => inflight.delete(key));
      inflight.set(key, work);
      return work;
    },
  };
}
