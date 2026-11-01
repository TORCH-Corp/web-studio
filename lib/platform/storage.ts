/**
 * TORCH platform file storage (c0 port).
 *
 * Replaces Supabase Storage. A site's files belong to that site (part 1,
 * session 1). The interface is the subset of `supabase.storage` that ycode
 * calls, with two implementations behind PLATFORM_STORAGE (session 8):
 *
 * - `disk` (default): files under `PLATFORM_STORAGE_DIR/{site}/{bucket}/{path}`.
 * - `document-center`: files are Document Center documents under the site's
 *   organization (lib/platform/storage-document-center.ts).
 *
 * Either way files are served and uploaded through `/platform-storage/...`
 * (see app/platform-storage): Document Center has no public URL.
 */

import fs from 'fs/promises';
import { createHmac, randomUUID, timingSafeEqual } from 'crypto';
import path from 'path';
import {
  copySiteFiles,
  createDocumentCenterStorageClient,
  hasDocumentCenterObject,
  readDocumentCenterObject,
  removeSiteFiles,
  writeDocumentCenterObject,
} from '@/lib/platform/storage-document-center';
import { safeKey, toBuffer, type FileMeta, type StorageError } from '@/lib/platform/storage-common';

export const STORAGE_DIR = process.env.PLATFORM_STORAGE_DIR || path.join(process.cwd(), 'storage', 'platform');
const PUBLIC_URL = (process.env.PLATFORM_PUBLIC_URL || 'http://127.0.0.1:3002').replace(/\/+$/, '');
const SECRET = process.env.BOS_SESSION_SECRET || 'change-me';

export function objectPath(siteId: string, bucket: string, key: string): string {
  return path.join(STORAGE_DIR, siteId, bucket, safeKey(key));
}

function sitePath(siteId: string): string {
  return path.join(STORAGE_DIR, siteId);
}

function metaPath(file: string): string {
  return file + '.meta.json';
}

/** The public URL of an object, the one an asset row stores in `public_url`: Web Studio's own route, in both modes. */
export function publicUrlFor(siteId: string, bucket: string, key: string): string {
  return `${PUBLIC_URL}/platform-storage/${siteId}/${bucket}/${safeKey(key)}`;
}

export function objectExists(siteId: string, bucket: string, key: string): Promise<boolean> {
  if (storageMode() === 'document-center') return hasDocumentCenterObject(siteId, bucket, key);
  return fs.stat(objectPath(siteId, bucket, key)).then((stat) => stat.isFile()).catch(() => false);
}

/**
 * Copy every file of one site to another (part 1, session 4: a site created
 * from a template gets the template's files). On disk the site's directory is
 * copied; in Document Center the bytes are uploaded again as new documents
 * under the new site's organization, which the caller names because the new
 * site's row is not committed yet while the template copy runs. A template
 * with no files is nothing to copy.
 */
export async function copySiteStorage(fromSiteId: string, toSiteId: string, toOrganizationId: string): Promise<void> {
  if (storageMode() === 'document-center') {
    await copySiteFiles(fromSiteId, toSiteId, toOrganizationId);
    return;
  }
  const source = sitePath(fromSiteId);
  const exists = await fs.stat(source).then((stat) => stat.isDirectory()).catch(() => false);
  if (!exists) return;
  await fs.cp(source, sitePath(toSiteId), { recursive: true, errorOnExist: true, force: false });
}

/** Remove every file of a site (a site whose creation failed after its files were copied). */
export async function removeSiteStorage(siteId: string): Promise<void> {
  if (storageMode() === 'document-center') {
    await removeSiteFiles(siteId);
    return;
  }
  await fs.rm(sitePath(siteId), { recursive: true, force: true });
}

export function signUpload(siteId: string, bucket: string, key: string, expires: number): string {
  return createHmac('sha256', SECRET).update(`${siteId}|${bucket}|${key}|${expires}`).digest('hex');
}

export function verifyUpload(siteId: string, bucket: string, key: string, expires: number, token: string): boolean {
  if (!Number.isFinite(expires) || expires < Date.now()) return false;
  const expected = signUpload(siteId, bucket, key, expires);
  return expected.length === token.length && timingSafeEqual(Buffer.from(expected), Buffer.from(token));
}

async function writeDiskObject(siteId: string, bucket: string, key: string, data: Buffer, contentType: string, cacheControl = 'max-age=3600'): Promise<void> {
  const file = objectPath(siteId, bucket, key);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, data);
  const meta: FileMeta = { contentType, cacheControl, size: data.length, updatedAt: new Date().toISOString() };
  await fs.writeFile(metaPath(file), JSON.stringify(meta));
}

async function readDiskObject(siteId: string, bucket: string, key: string): Promise<{ data: Buffer; meta: FileMeta } | null> {
  const file = objectPath(siteId, bucket, key);
  try {
    const [data, metaRaw] = await Promise.all([fs.readFile(file), fs.readFile(metaPath(file), 'utf8').catch(() => '')]);
    const meta: FileMeta = metaRaw ? JSON.parse(metaRaw) : { contentType: 'application/octet-stream', cacheControl: 'max-age=3600', size: data.length, updatedAt: '' };
    return { data, meta };
  } catch {
    return null;
  }
}

function createDiskStorageClient(siteId: string | null) {
  const site = () => {
    if (!siteId) throw new Error('No site in context for storage');
    return siteId;
  };

  const bucketApi = (bucket: string) => ({
    async upload(key: string, body: unknown, options?: { contentType?: string; cacheControl?: string; upsert?: boolean }) {
      try {
        const file = objectPath(site(), bucket, key);
        const exists = await fs.stat(file).then(() => true).catch(() => false);
        if (exists && !options?.upsert) {
          return { data: null, error: { message: 'The resource already exists', statusCode: '409', error: 'Duplicate' } as StorageError };
        }
        await writeDiskObject(site(), bucket, key, await toBuffer(body), options?.contentType || 'application/octet-stream', options?.cacheControl ? `max-age=${options.cacheControl}` : undefined);
        return { data: { path: safeKey(key), fullPath: `${bucket}/${safeKey(key)}`, id: randomUUID() }, error: null };
      } catch (e) {
        return { data: null, error: { message: (e as Error).message } as StorageError };
      }
    },

    async remove(keys: string[]) {
      const removed: Array<{ name: string; bucket_id: string }> = [];
      for (const key of keys) {
        const file = objectPath(site(), bucket, key);
        await fs.rm(file, { force: true });
        await fs.rm(metaPath(file), { force: true });
        removed.push({ name: key, bucket_id: bucket });
      }
      return { data: removed, error: null };
    },

    async download(key: string) {
      const obj = await readDiskObject(site(), bucket, key);
      if (!obj) return { data: null, error: { message: 'Object not found', statusCode: '404', error: 'not_found' } as StorageError };
      return { data: new Blob([new Uint8Array(obj.data)], { type: obj.meta.contentType }), error: null };
    },

    getPublicUrl(key: string) {
      return { data: { publicUrl: publicUrlFor(site(), bucket, key) } };
    },

    async createSignedUploadUrl(key: string) {
      const expires = Date.now() + 60 * 60 * 1000;
      const token = signUpload(site(), bucket, safeKey(key), expires);
      return {
        data: {
          signedUrl: `${PUBLIC_URL}/platform-storage/upload/${site()}/${bucket}/${safeKey(key)}?token=${token}&expires=${expires}`,
          token,
          path: safeKey(key),
        },
        error: null,
      };
    },

    async list(prefix = '') {
      const dir = path.join(objectPath(site(), bucket, prefix || '.'));
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        const data = entries.filter((e) => !e.name.endsWith('.meta.json')).map((e) => ({ name: e.name, id: e.isDirectory() ? null : e.name }));
        return { data, error: null };
      } catch {
        return { data: [], error: null };
      }
    },

    async move(from: string, to: string) {
      const src = objectPath(site(), bucket, from);
      const dst = objectPath(site(), bucket, to);
      await fs.mkdir(path.dirname(dst), { recursive: true });
      await fs.rename(src, dst);
      await fs.rename(metaPath(src), metaPath(dst)).catch(() => undefined);
      return { data: { message: 'Successfully moved' }, error: null };
    },

    async copy(from: string, to: string) {
      const src = objectPath(site(), bucket, from);
      const dst = objectPath(site(), bucket, to);
      await fs.mkdir(path.dirname(dst), { recursive: true });
      await fs.copyFile(src, dst);
      await fs.copyFile(metaPath(src), metaPath(dst)).catch(() => undefined);
      return { data: { path: safeKey(to) }, error: null };
    },
  });

  return {
    from: bucketApi,
    async createBucket(id: string) {
      await fs.mkdir(path.join(STORAGE_DIR, site(), id), { recursive: true });
      return { data: { name: id }, error: null };
    },
    async getBucket(id: string) {
      const exists = await fs.stat(path.join(STORAGE_DIR, site(), id)).then(() => true).catch(() => false);
      return exists ? { data: { id, name: id, public: true }, error: null } : { data: null, error: { message: 'Bucket not found', statusCode: '404' } as StorageError };
    },
    async listBuckets() {
      const entries = await fs.readdir(path.join(STORAGE_DIR, site())).catch(() => [] as string[]);
      return { data: entries.map((name) => ({ id: name, name, public: true })), error: null };
    },
    async emptyBucket(id: string) {
      await fs.rm(path.join(STORAGE_DIR, site(), id), { recursive: true, force: true });
      await fs.mkdir(path.join(STORAGE_DIR, site(), id), { recursive: true });
      return { data: { message: 'Successfully emptied' }, error: null };
    },
    async deleteBucket(id: string) {
      await fs.rm(path.join(STORAGE_DIR, site(), id), { recursive: true, force: true });
      return { data: { message: 'Successfully deleted' }, error: null };
    },
  };
}

function storageMode(): 'disk' | 'document-center' {
  const mode = process.env.PLATFORM_STORAGE || 'disk';
  if (mode !== 'disk' && mode !== 'document-center') {
    throw new Error(`PLATFORM_STORAGE must be "disk" or "document-center", got "${mode}"`);
  }
  return mode;
}

export type StorageClient = ReturnType<typeof createDiskStorageClient> | ReturnType<typeof createDocumentCenterStorageClient>;

export function createStorageClient(siteId: string | null): StorageClient {
  const disk = createDiskStorageClient(siteId);
  if (storageMode() === 'disk') return disk;
  // The URL and the signed upload URL point at Web Studio's own route in both modes, so the
  // Document Center client borrows them from the disk client (neither touches the disk).
  const documentCenter = createDocumentCenterStorageClient(siteId);
  return {
    ...documentCenter,
    from: (bucket: string) => {
      const files = disk.from(bucket);
      return { ...documentCenter.from(bucket), getPublicUrl: files.getPublicUrl, createSignedUploadUrl: files.createSignedUploadUrl };
    },
  };
}

export function writeObject(siteId: string, bucket: string, key: string, data: Buffer, contentType: string, cacheControl?: string): Promise<void> {
  return storageMode() === 'document-center'
    ? writeDocumentCenterObject(siteId, bucket, key, data, contentType, cacheControl)
    : writeDiskObject(siteId, bucket, key, data, contentType, cacheControl);
}

export function readObject(siteId: string, bucket: string, key: string): Promise<{ data: Buffer; meta: FileMeta } | null> {
  return storageMode() === 'document-center' ? readDocumentCenterObject(siteId, bucket, key) : readDiskObject(siteId, bucket, key);
}
