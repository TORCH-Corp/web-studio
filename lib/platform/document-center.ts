/**
 * Document Center client for Web Studio's file storage (part 1, session 8).
 *
 * Paths, headers, body keys and envelopes are from Document Center's live spec
 * (`/documentation/json`, checked 1 Nov 2026) and torch-core-backend's
 * `docs/document-center-integration-contract.md`. There is no `/api` prefix.
 * Every call carries `x-service-api-key` and `x-entity-id` (the organization).
 * There is no public or presigned URL: bytes are read back through
 * `GET /documents/{id}/download` and re-served by /platform-storage.
 */

const TIMEOUT_MS = 30_000;
const FOLDER_NAME = 'Web Studio';

/** Document Center's MAX_FILE_SIZE (50 MB in production). Base64 adds a third on the wire. */
export const MAX_FILE_SIZE = Number(process.env.DOCUMENT_CENTER_MAX_FILE_SIZE) || 50 * 1024 * 1024;

export class DocumentCenterError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'DocumentCenterError';
  }
}

function config(): { baseUrl: string; apiKey: string } {
  const baseUrl = (process.env.DOCUMENT_CENTER_URL || '').replace(/\/+$/, '');
  const apiKey = process.env.DOCUMENT_CENTER_API_KEY || '';
  if (!baseUrl || !apiKey) {
    throw new Error('PLATFORM_STORAGE=document-center needs DOCUMENT_CENTER_URL and DOCUMENT_CENTER_API_KEY');
  }
  return { baseUrl, apiKey };
}

async function call(op: string, organizationId: string, path: string, init: { method: string; body?: unknown }): Promise<Response> {
  const { baseUrl, apiKey } = config();
  const headers: Record<string, string> = { 'x-service-api-key': apiKey, 'x-entity-id': organizationId };
  if (init.body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(`${baseUrl}${path}`, {
    method: init.method,
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).slice(0, 300);
    throw new DocumentCenterError(`Document Center ${op} failed (${res.status}): ${detail}`, res.status);
  }
  return res;
}

// Folder ids per organization. On globalThis because Next bundles every route on its own.
const globalForFolders = globalThis as unknown as { __wsDcFolders?: Map<string, string> };
const folders = (globalForFolders.__wsDcFolders ??= new Map<string, string>());

interface FolderRow { id: string; name: string }

/**
 * The organization's "Web Studio" folder, made once with `isSystem` so nobody
 * can rename or delete it. Failing here fails the upload: the alternative is
 * the organization's library root, where site files would sit beside contracts.
 */
export async function ensureFolder(organizationId: string): Promise<string> {
  const cached = folders.get(organizationId);
  if (cached) return cached;

  const find = async (): Promise<string | null> => {
    const body = (await (await call('list folders', organizationId, '/folders', { method: 'GET' })).json()) as { data?: FolderRow[] };
    return body.data?.find((row) => row.name === FOLDER_NAME)?.id ?? null;
  };

  let id = await find();
  if (!id) {
    try {
      const res = await call('create folder', organizationId, '/folders', {
        method: 'POST',
        body: { name: FOLDER_NAME, scope: 'ORGANIZATION', isSystem: true },
      });
      id = ((await res.json()) as { data?: { id?: string } }).data?.id ?? null;
    } catch (e) {
      // Lost the unique (organization, parent, name) race to a concurrent upload: look once more.
      if (!(e instanceof DocumentCenterError) || e.status !== 409) throw e;
      id = await find();
    }
  }
  if (!id) throw new Error('Document Center did not return the Web Studio folder');
  folders.set(organizationId, id);
  return id;
}

/** POST /documents/service-upload. Answers `201 { data: { id } }`; the file is a new document. */
export async function uploadDocument(args: {
  organizationId: string;
  siteId: string;
  name: string;
  filename: string;
  mimeType: string;
  data: Buffer;
}): Promise<string> {
  if (args.data.length === 0) throw new Error('Cannot upload an empty file');
  if (args.data.length > MAX_FILE_SIZE) {
    throw new Error(`File is ${args.data.length} bytes; the limit is ${MAX_FILE_SIZE}`);
  }
  const folderId = await ensureFolder(args.organizationId);
  const res = await call('upload', args.organizationId, '/documents/service-upload', {
    method: 'POST',
    body: {
      file: args.data.toString('base64'),
      filename: args.filename,
      mimeType: args.mimeType,
      name: args.name,
      folderId,
      origin: 'UPLOAD',
      sensitivity: 'NORMAL',
      linkedEntityType: 'CUSTOM',
      linkedEntityId: args.siteId,
      linkType: 'ATTACHMENT',
    },
  });
  const id = ((await res.json()) as { data?: { id?: string } }).data?.id;
  if (!id) throw new Error('Document Center did not return a document id');
  return id;
}

/** GET /documents/{id}/download: the bytes, null when the document is gone. */
export async function downloadDocument(organizationId: string, documentId: string): Promise<Buffer | null> {
  try {
    const res = await call('download', organizationId, `/documents/${documentId}/download`, { method: 'GET' });
    return Buffer.from(await res.arrayBuffer());
  } catch (e) {
    if (e instanceof DocumentCenterError && e.status === 404) return null;
    throw e;
  }
}

/**
 * DELETE /documents/{id}: a soft delete into the organization's trash. A 404
 * counts as deleted. The route is JWT-only today (`authenticate`, not
 * `authenticateServiceOrUser`), so a service-key call answers 401 until
 * Document Center admits the service key there (OPEN_QUESTIONS item 12).
 */
export async function deleteDocument(organizationId: string, documentId: string): Promise<void> {
  try {
    await call('delete', organizationId, `/documents/${documentId}`, { method: 'DELETE' });
  } catch (e) {
    if (e instanceof DocumentCenterError && e.status === 404) return;
    throw e;
  }
}
