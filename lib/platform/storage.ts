/**
 * TORCH platform file storage (c0 port).
 *
 * Replaces Supabase Storage with files on disk under
 * `PLATFORM_STORAGE_DIR/{organization}/{bucket}/{path}`, served and uploaded
 * through `/platform-storage/...` (see app/platform-storage). The interface is
 * the subset of `supabase.storage` that ycode calls. Swapping the disk for the
 * platform object store later means changing this file only.
 */

import fs from 'fs/promises';
import { createHmac, randomUUID, timingSafeEqual } from 'crypto';
import path from 'path';

export const STORAGE_DIR = process.env.PLATFORM_STORAGE_DIR || path.join(process.cwd(), 'storage', 'platform');
const PUBLIC_URL = (process.env.PLATFORM_PUBLIC_URL || 'http://127.0.0.1:3002').replace(/\/+$/, '');
const SECRET = process.env.BOS_SESSION_SECRET || 'change-me';

interface StorageError { message: string; statusCode?: string; error?: string }
interface FileMeta { contentType: string; cacheControl: string; size: number; updatedAt: string }

function safeKey(key: string): string {
  const normalised = path.posix.normalize('/' + key.replace(/\\/g, '/')).slice(1);
  if (normalised.startsWith('..')) throw new Error('Invalid storage path');
  return normalised;
}

export function objectPath(organizationId: string, bucket: string, key: string): string {
  return path.join(STORAGE_DIR, organizationId, bucket, safeKey(key));
}

function metaPath(file: string): string {
  return file + '.meta.json';
}

export function signUpload(organizationId: string, bucket: string, key: string, expires: number): string {
  return createHmac('sha256', SECRET).update(`${organizationId}|${bucket}|${key}|${expires}`).digest('hex');
}

export function verifyUpload(organizationId: string, bucket: string, key: string, expires: number, token: string): boolean {
  if (!Number.isFinite(expires) || expires < Date.now()) return false;
  const expected = signUpload(organizationId, bucket, key, expires);
  return expected.length === token.length && timingSafeEqual(Buffer.from(expected), Buffer.from(token));
}

export async function writeObject(organizationId: string, bucket: string, key: string, data: Buffer, contentType: string, cacheControl = 'max-age=3600'): Promise<void> {
  const file = objectPath(organizationId, bucket, key);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, data);
  const meta: FileMeta = { contentType, cacheControl, size: data.length, updatedAt: new Date().toISOString() };
  await fs.writeFile(metaPath(file), JSON.stringify(meta));
}

export async function readObject(organizationId: string, bucket: string, key: string): Promise<{ data: Buffer; meta: FileMeta } | null> {
  const file = objectPath(organizationId, bucket, key);
  try {
    const [data, metaRaw] = await Promise.all([fs.readFile(file), fs.readFile(metaPath(file), 'utf8').catch(() => '')]);
    const meta: FileMeta = metaRaw ? JSON.parse(metaRaw) : { contentType: 'application/octet-stream', cacheControl: 'max-age=3600', size: data.length, updatedAt: '' };
    return { data, meta };
  } catch {
    return null;
  }
}

async function toBuffer(body: unknown): Promise<Buffer> {
  if (Buffer.isBuffer(body)) return body;
  if (body instanceof Uint8Array) return Buffer.from(body);
  if (body instanceof ArrayBuffer) return Buffer.from(body);
  if (typeof body === 'string') return Buffer.from(body);
  if (body && typeof (body as Blob).arrayBuffer === 'function') return Buffer.from(await (body as Blob).arrayBuffer());
  if (body && typeof (body as ReadableStream).getReader === 'function') {
    const chunks: Uint8Array[] = [];
    const reader = (body as ReadableStream<Uint8Array>).getReader();
    for (;;) { const { done, value } = await reader.read(); if (done) break; if (value) chunks.push(value); }
    return Buffer.concat(chunks);
  }
  throw new Error('Unsupported upload body');
}

export function createStorageClient(organizationId: string | null) {
  const org = () => {
    if (!organizationId) throw new Error('No organization in context for storage');
    return organizationId;
  };

  const bucketApi = (bucket: string) => ({
    async upload(key: string, body: unknown, options?: { contentType?: string; cacheControl?: string; upsert?: boolean }) {
      try {
        const file = objectPath(org(), bucket, key);
        const exists = await fs.stat(file).then(() => true).catch(() => false);
        if (exists && !options?.upsert) {
          return { data: null, error: { message: 'The resource already exists', statusCode: '409', error: 'Duplicate' } as StorageError };
        }
        await writeObject(org(), bucket, key, await toBuffer(body), options?.contentType || 'application/octet-stream', options?.cacheControl ? `max-age=${options.cacheControl}` : undefined);
        return { data: { path: safeKey(key), fullPath: `${bucket}/${safeKey(key)}`, id: randomUUID() }, error: null };
      } catch (e) {
        return { data: null, error: { message: (e as Error).message } as StorageError };
      }
    },

    async remove(keys: string[]) {
      const removed: Array<{ name: string; bucket_id: string }> = [];
      for (const key of keys) {
        const file = objectPath(org(), bucket, key);
        await fs.rm(file, { force: true });
        await fs.rm(metaPath(file), { force: true });
        removed.push({ name: key, bucket_id: bucket });
      }
      return { data: removed, error: null };
    },

    async download(key: string) {
      const obj = await readObject(org(), bucket, key);
      if (!obj) return { data: null, error: { message: 'Object not found', statusCode: '404', error: 'not_found' } as StorageError };
      return { data: new Blob([new Uint8Array(obj.data)], { type: obj.meta.contentType }), error: null };
    },

    getPublicUrl(key: string) {
      return { data: { publicUrl: `${PUBLIC_URL}/platform-storage/${org()}/${bucket}/${safeKey(key)}` } };
    },

    async createSignedUploadUrl(key: string) {
      const expires = Date.now() + 60 * 60 * 1000;
      const token = signUpload(org(), bucket, safeKey(key), expires);
      return {
        data: {
          signedUrl: `${PUBLIC_URL}/platform-storage/upload/${org()}/${bucket}/${safeKey(key)}?token=${token}&expires=${expires}`,
          token,
          path: safeKey(key),
        },
        error: null,
      };
    },

    async list(prefix = '') {
      const dir = path.join(objectPath(org(), bucket, prefix || '.'));
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        const data = entries.filter((e) => !e.name.endsWith('.meta.json')).map((e) => ({ name: e.name, id: e.isDirectory() ? null : e.name }));
        return { data, error: null };
      } catch {
        return { data: [], error: null };
      }
    },

    async move(from: string, to: string) {
      const src = objectPath(org(), bucket, from);
      const dst = objectPath(org(), bucket, to);
      await fs.mkdir(path.dirname(dst), { recursive: true });
      await fs.rename(src, dst);
      await fs.rename(metaPath(src), metaPath(dst)).catch(() => undefined);
      return { data: { message: 'Successfully moved' }, error: null };
    },

    async copy(from: string, to: string) {
      const src = objectPath(org(), bucket, from);
      const dst = objectPath(org(), bucket, to);
      await fs.mkdir(path.dirname(dst), { recursive: true });
      await fs.copyFile(src, dst);
      await fs.copyFile(metaPath(src), metaPath(dst)).catch(() => undefined);
      return { data: { path: safeKey(to) }, error: null };
    },
  });

  return {
    from: bucketApi,
    async createBucket(id: string) {
      await fs.mkdir(path.join(STORAGE_DIR, org(), id), { recursive: true });
      return { data: { name: id }, error: null };
    },
    async getBucket(id: string) {
      const exists = await fs.stat(path.join(STORAGE_DIR, org(), id)).then(() => true).catch(() => false);
      return exists ? { data: { id, name: id, public: true }, error: null } : { data: null, error: { message: 'Bucket not found', statusCode: '404' } as StorageError };
    },
    async listBuckets() {
      const entries = await fs.readdir(path.join(STORAGE_DIR, org())).catch(() => [] as string[]);
      return { data: entries.map((name) => ({ id: name, name, public: true })), error: null };
    },
    async emptyBucket(id: string) {
      await fs.rm(path.join(STORAGE_DIR, org(), id), { recursive: true, force: true });
      await fs.mkdir(path.join(STORAGE_DIR, org(), id), { recursive: true });
      return { data: { message: 'Successfully emptied' }, error: null };
    },
    async deleteBucket(id: string) {
      await fs.rm(path.join(STORAGE_DIR, org(), id), { recursive: true, force: true });
      return { data: { message: 'Successfully deleted' }, error: null };
    },
  };
}
