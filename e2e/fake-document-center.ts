/**
 * A recorded copy of Document Center's file contract, for the e2e suite
 * (session 8): the routes, headers, body keys and envelopes Web Studio uses,
 * as served by the live spec on 1 Nov 2026. Run by playwright.config.ts.
 *
 * - every call needs `x-service-api-key` (401) and `x-entity-id` (400);
 * - folders and documents belong to the `x-entity-id` organization, and
 *   another organization's id answers 404;
 * - DELETE is a soft delete; the live service answers 401 to a service key
 *   today, this copy admits it (the guard Web Studio asks Document Center to
 *   widen, OPEN_QUESTIONS item 12);
 * - GET /__state?entity={id} lists what the organization has, for the specs.
 */

import http from 'http';
import { randomUUID } from 'crypto';

const KEY = process.env.FAKE_DC_KEY || 'e2e-document-center-key';
const PORT = Number(process.env.FAKE_DC_PORT || 3103);

interface Folder { id: string; name: string; isSystem: boolean }
interface Doc { id: string; name: string; filename: string; mimeType: string; folderId: string | null; data: Buffer; linkedEntityId?: string; deleted: boolean }

const folders = new Map<string, Folder[]>();
const docs = new Map<string, Map<string, Doc>>();

function send(res: http.ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  const payload = Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body));
  res.writeHead(status, { 'content-type': Buffer.isBuffer(body) ? 'application/octet-stream' : 'application/json', 'content-length': payload.length, ...headers });
  res.end(payload);
}

async function readJson(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
}

http
  .createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', 'http://fake');
      if (url.pathname === '/__health') return send(res, 200, { ok: true });
      if (url.pathname === '/__state') {
        const entity = url.searchParams.get('entity') || '';
        const mine = [...(docs.get(entity)?.values() ?? [])].map((d) => ({ id: d.id, name: d.name, filename: d.filename, mimeType: d.mimeType, size: d.data.length, folder: folders.get(entity)?.find((f) => f.id === d.folderId)?.name ?? null, linkedEntityId: d.linkedEntityId, deleted: d.deleted }));
        return send(res, 200, { data: mine });
      }
      if (req.headers['x-service-api-key'] !== KEY) return send(res, 401, { statusCode: 401, error: 'Unauthorized', message: 'Invalid or expired token' });
      const entity = req.headers['x-entity-id'];
      if (typeof entity !== 'string' || !entity) return send(res, 400, { statusCode: 400, error: 'Bad Request', message: 'x-entity-id header required for service requests' });

      if (url.pathname === '/folders' && req.method === 'GET') return send(res, 200, { data: folders.get(entity) ?? [] });
      if (url.pathname === '/folders' && req.method === 'POST') {
        const body = await readJson(req);
        const list = folders.get(entity) ?? [];
        if (list.some((f) => f.name === body.name)) return send(res, 409, { statusCode: 409, error: 'Conflict', message: 'Folder name exists' });
        const folder = { id: randomUUID(), name: String(body.name), isSystem: body.isSystem === true };
        folders.set(entity, [...list, folder]);
        return send(res, 201, { data: folder });
      }
      if (url.pathname === '/documents/service-upload' && req.method === 'POST') {
        const body = await readJson(req);
        for (const k of ['file', 'filename', 'mimeType', 'name']) {
          if (typeof body[k] !== 'string' || !body[k]) return send(res, 400, { statusCode: 400, error: 'Bad Request', message: `body must have required property '${k}'` });
        }
        const data = Buffer.from(body.file as string, 'base64');
        if (data.length === 0) return send(res, 400, { statusCode: 400, error: 'Bad Request', message: 'Empty file' });
        const doc: Doc = { id: randomUUID(), name: body.name as string, filename: body.filename as string, mimeType: body.mimeType as string, folderId: (body.folderId as string) ?? null, data, linkedEntityId: body.linkedEntityId as string | undefined, deleted: false };
        docs.set(entity, (docs.get(entity) ?? new Map()).set(doc.id, doc));
        return send(res, 201, { data: { id: doc.id, name: doc.name, mimeType: doc.mimeType, fileSize: String(data.length), folderId: doc.folderId } });
      }
      const match = url.pathname.match(/^\/documents\/([0-9a-f-]{36})(\/download)?$/);
      if (match) {
        const doc = docs.get(entity)?.get(match[1]);
        if (!doc || doc.deleted) return send(res, 404, { statusCode: 404, error: 'Not Found', message: 'Document not found' });
        if (match[2] && req.method === 'GET') return send(res, 200, doc.data, { 'content-type': doc.mimeType, 'content-disposition': `attachment; filename="${doc.filename}"` });
        if (!match[2] && req.method === 'DELETE') {
          doc.deleted = true;
          return send(res, 200, { id: doc.id, code: 'DOC-1', name: doc.name, deletedAt: new Date().toISOString(), message: 'Document moved to trash' });
        }
      }
      return send(res, 404, { statusCode: 404, error: 'Not Found', message: `Route ${req.method}:${url.pathname} not found` });
    } catch (e) {
      send(res, 500, { statusCode: 500, error: 'Internal Server Error', message: (e as Error).message });
    }
  })
  .listen(PORT, '127.0.0.1', () => console.log(`fake Document Center on ${PORT}`));
