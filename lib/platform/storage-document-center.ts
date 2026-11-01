/**
 * Document Center implementation of the platform storage (part 1, session 8).
 *
 * Same interface as the disk client in storage.ts. A file is a Document Center
 * document in the "Web Studio" folder of the site's organization;
 * `platform_storage_objects` maps (site, bucket, key) to the document, so the
 * builder's asset rows keep their `storage_path` and only `public_url` is new.
 * Bytes are read back through the service key and cached here, because
 * Document Center has no public URL (OPEN_QUESTIONS item 1).
 */

import { randomUUID } from 'crypto';
import path from 'path';
import { getKnexClient } from '@/lib/knex-client';
import { deleteDocument, downloadDocument, uploadDocument } from '@/lib/platform/document-center';
import { safeKey, toBuffer, type FileMeta, type StorageError } from '@/lib/platform/storage-common';

const TABLE = 'platform_storage_objects';
const DEFAULT_CACHE_CONTROL = 'max-age=3600';

interface ObjectRow {
  id: string;
  site_id: string;
  organization_id: string;
  bucket: string;
  key: string;
  document_id: string;
  content_type: string;
  cache_control: string;
  size: string | number;
  created_at: Date;
}

// Bytes by document id. A document never changes (a re-upload is a new document), so no invalidation.
const CACHE_MAX_BYTES = 64 * 1024 * 1024;
const CACHE_MAX_ITEM_BYTES = 8 * 1024 * 1024;
const globalForCache = globalThis as unknown as { __wsDcBytes?: Map<string, Buffer> };
const cache = (globalForCache.__wsDcBytes ??= new Map<string, Buffer>());
let cacheBytes = 0;

function cacheGet(documentId: string): Buffer | undefined {
  const hit = cache.get(documentId);
  if (hit) { cache.delete(documentId); cache.set(documentId, hit); }
  return hit;
}

function cachePut(documentId: string, data: Buffer): void {
  if (data.length > CACHE_MAX_ITEM_BYTES || cache.has(documentId)) return;
  cache.set(documentId, data);
  cacheBytes += data.length;
  for (const [id, old] of cache) {
    if (cacheBytes <= CACHE_MAX_BYTES) break;
    cache.delete(id);
    cacheBytes -= old.length;
  }
}

async function organizationOf(siteId: string): Promise<string> {
  const knex = await getKnexClient();
  const row = await knex('platform_sites').where({ id: siteId }).first<{ organization_id: string } | undefined>('organization_id');
  if (!row) throw new Error(`Site ${siteId} not found`);
  return row.organization_id;
}

async function findRow(siteId: string, bucket: string, key: string): Promise<ObjectRow | undefined> {
  const knex = await getKnexClient();
  return knex<ObjectRow>(TABLE).where({ site_id: siteId, bucket, key }).first();
}

/** Delete the documents behind removed rows. A refusal is logged with the id, never swallowed silently. */
async function deleteDocuments(rows: Array<Pick<ObjectRow, 'organization_id' | 'document_id' | 'bucket' | 'key'>>): Promise<void> {
  for (const row of rows) {
    cache.delete(row.document_id);
    try {
      await deleteDocument(row.organization_id, row.document_id);
    } catch (e) {
      console.error(`Document Center kept document ${row.document_id} (${row.bucket}/${row.key}) after the builder removed it: ${(e as Error).message}`);
    }
  }
}

/**
 * Store bytes as a new document and point (site, bucket, key) at it, replacing
 * and deleting the old document. `knownOrganizationId` is for a site whose row
 * is not committed yet (a template copy inside the provisioning transaction).
 */
export async function writeDocumentCenterObject(siteId: string, bucket: string, key: string, data: Buffer, contentType: string, cacheControl = DEFAULT_CACHE_CONTROL, knownOrganizationId?: string): Promise<void> {
  const normalised = safeKey(key);
  const organizationId = knownOrganizationId ?? (await organizationOf(siteId));
  const documentId = await uploadDocument({
    organizationId,
    siteId,
    name: `${bucket}/${normalised}`,
    filename: path.posix.basename(normalised),
    mimeType: contentType,
    data,
  });
  const knex = await getKnexClient();
  const previous = await knex.transaction(async (trx) => {
    const old = await trx<ObjectRow>(TABLE).where({ site_id: siteId, bucket, key: normalised }).forUpdate().first();
    const values = { organization_id: organizationId, document_id: documentId, content_type: contentType, cache_control: cacheControl, size: data.length, created_at: new Date() };
    if (old) await trx(TABLE).where({ id: old.id }).update(values);
    else await trx(TABLE).insert({ site_id: siteId, bucket, key: normalised, ...values });
    return old;
  });
  if (previous) await deleteDocuments([previous]);
}

export async function readDocumentCenterObject(siteId: string, bucket: string, key: string): Promise<{ data: Buffer; meta: FileMeta } | null> {
  const row = await findRow(siteId, bucket, safeKey(key));
  if (!row) return null;
  let data = cacheGet(row.document_id);
  if (!data) {
    const fetched = await downloadDocument(row.organization_id, row.document_id);
    if (!fetched) return null;
    data = fetched;
    cachePut(row.document_id, data);
  }
  return {
    data,
    meta: { contentType: row.content_type, cacheControl: row.cache_control, size: Number(row.size), updatedAt: new Date(row.created_at).toISOString() },
  };
}

/**
 * Copy every file of one site into another (template copies, session 4): the
 * bytes are uploaded again as new documents under the destination's
 * organization (named by the caller: the new site's row is not committed yet),
 * because Document Center has no copy route. Returns the number of files.
 */
export async function copySiteFiles(fromSiteId: string, toSiteId: string, toOrganizationId: string): Promise<number> {
  const knex = await getKnexClient();
  const rows = await knex<ObjectRow>(TABLE).where({ site_id: fromSiteId }).orderBy('created_at');
  for (const row of rows) {
    const obj = await readDocumentCenterObject(fromSiteId, row.bucket, row.key);
    if (!obj) throw new Error(`Document ${row.document_id} (${row.bucket}/${row.key}) is missing in Document Center`);
    await writeDocumentCenterObject(toSiteId, row.bucket, row.key, obj.data, row.content_type, row.cache_control, toOrganizationId);
  }
  return rows.length;
}

/** Whether (site, bucket, key) names a document. */
export async function hasDocumentCenterObject(siteId: string, bucket: string, key: string): Promise<boolean> {
  return Boolean(await findRow(siteId, bucket, safeKey(key)));
}

/** Forget every file of a site and delete its documents (a site whose creation failed after its files were copied, session 4). */
export async function removeSiteFiles(siteId: string): Promise<void> {
  const knex = await getKnexClient();
  const rows = await knex<ObjectRow>(TABLE).where({ site_id: siteId });
  if (rows.length === 0) return;
  await knex(TABLE).whereIn('id', rows.map((r) => r.id)).delete();
  await deleteDocuments(rows);
}

export function createDocumentCenterStorageClient(siteId: string | null) {
  const site = () => {
    if (!siteId) throw new Error('No site in context for storage');
    return siteId;
  };
  const notFound = (message: string): { data: null; error: StorageError } => ({ data: null, error: { message, statusCode: '404', error: 'not_found' } });

  const bucketApi = (bucket: string) => ({
    async upload(key: string, body: unknown, options?: { contentType?: string; cacheControl?: string; upsert?: boolean }) {
      try {
        const normalised = safeKey(key);
        if (!options?.upsert && (await findRow(site(), bucket, normalised))) {
          return { data: null, error: { message: 'The resource already exists', statusCode: '409', error: 'Duplicate' } as StorageError };
        }
        await writeDocumentCenterObject(site(), bucket, normalised, await toBuffer(body), options?.contentType || 'application/octet-stream', options?.cacheControl ? `max-age=${options.cacheControl}` : undefined);
        return { data: { path: normalised, fullPath: `${bucket}/${normalised}`, id: randomUUID() }, error: null };
      } catch (e) {
        return { data: null, error: { message: (e as Error).message } as StorageError };
      }
    },

    async remove(keys: string[]) {
      const knex = await getKnexClient();
      const normalised = keys.map(safeKey);
      const rows = await knex<ObjectRow>(TABLE).where({ site_id: site(), bucket }).whereIn('key', normalised);
      await knex(TABLE).whereIn('id', rows.map((r) => r.id)).delete();
      await deleteDocuments(rows);
      return { data: rows.map((r) => ({ name: r.key, bucket_id: bucket })), error: null };
    },

    async download(key: string) {
      try {
        const obj = await readDocumentCenterObject(site(), bucket, key);
        if (!obj) return notFound('Object not found');
        return { data: new Blob([new Uint8Array(obj.data)], { type: obj.meta.contentType }), error: null };
      } catch (e) {
        return { data: null, error: { message: (e as Error).message } as StorageError };
      }
    },

    // getPublicUrl and createSignedUploadUrl point at Web Studio's /platform-storage route
    // and are shared with the disk client (see createStorageClient in storage.ts).

    async list(prefix = '') {
      const knex = await getKnexClient();
      const dir = prefix ? safeKey(prefix).replace(/\/+$/, '') + '/' : '';
      const rows = await knex<ObjectRow>(TABLE).where({ site_id: site(), bucket }).where('key', 'like', dir.replace(/[\\%_]/g, '\\$&') + '%').select('key');
      const names = new Map<string, boolean>();
      for (const { key } of rows) {
        const rest = key.slice(dir.length);
        const slash = rest.indexOf('/');
        names.set(slash === -1 ? rest : rest.slice(0, slash), slash !== -1);
      }
      return { data: [...names].map(([name, isDir]) => ({ name, id: isDir ? null : name })), error: null };
    },

    async move(from: string, to: string) {
      try {
        const knex = await getKnexClient();
        const src = await findRow(site(), bucket, safeKey(from));
        if (!src) return notFound('Object not found');
        const dst = safeKey(to);
        const clash = await findRow(site(), bucket, dst);
        if (clash && clash.id !== src.id) return { data: null, error: { message: 'The resource already exists', statusCode: '409', error: 'Duplicate' } as StorageError };
        await knex(TABLE).where({ id: src.id }).update({ key: dst });
        return { data: { message: 'Successfully moved' }, error: null };
      } catch (e) {
        return { data: null, error: { message: (e as Error).message } as StorageError };
      }
    },

    async copy(from: string, to: string) {
      try {
        const src = await readDocumentCenterObject(site(), bucket, from);
        if (!src) return notFound('Object not found');
        await writeDocumentCenterObject(site(), bucket, to, src.data, src.meta.contentType, src.meta.cacheControl);
        return { data: { path: safeKey(to) }, error: null };
      } catch (e) {
        return { data: null, error: { message: (e as Error).message } as StorageError };
      }
    },
  });

  // Buckets are only a prefix of the key here: they need no creating.
  const emptyBucket = async (id: string) => {
    const knex = await getKnexClient();
    const rows = await knex<ObjectRow>(TABLE).where({ site_id: site(), bucket: id });
    await knex(TABLE).whereIn('id', rows.map((r) => r.id)).delete();
    await deleteDocuments(rows);
  };

  return {
    from: bucketApi,
    async createBucket(id: string) {
      return { data: { name: id }, error: null };
    },
    async getBucket(id: string) {
      return { data: { id, name: id, public: true }, error: null };
    },
    async listBuckets() {
      const knex = await getKnexClient();
      const rows = await knex(TABLE).where({ site_id: site() }).distinct('bucket');
      return { data: rows.map(({ bucket }) => ({ id: bucket as string, name: bucket as string, public: true })), error: null };
    },
    async emptyBucket(id: string) {
      await emptyBucket(id);
      return { data: { message: 'Successfully emptied' }, error: null };
    },
    async deleteBucket(id: string) {
      await emptyBucket(id);
      return { data: { message: 'Successfully deleted' }, error: null };
    },
  };
}
