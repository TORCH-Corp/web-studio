import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, test } from 'node:test';
import type { AddressInfo } from 'node:net';

interface Seen { method?: string; url?: string; key?: string; entity?: string; body: Record<string, unknown> }
const seen: Seen[] = [];
let server: http.Server;
let status = 200;

before(async () => {
  server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const raw = Buffer.concat(chunks).toString();
    seen.push({ method: req.method, url: req.url, key: req.headers['x-service-api-key'] as string, entity: req.headers['x-entity-id'] as string, body: raw ? JSON.parse(raw) : {} });
    if (status === 200 && req.url === '/documents/img-1/download') {
      res.writeHead(200, { 'content-type': 'Image/PNG; charset=binary' });
      return res.end(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    }
    res.writeHead(status, { 'content-type': 'application/json' });
    if (status !== 200 && status !== 201) return res.end('{"message":"no"}');
    if (req.url === '/folders' && req.method === 'GET') return res.end('{"data":[]}');
    if (req.url === '/folders') return res.end('{"data":{"id":"folder-1"}}');
    if (req.url === '/documents/service-upload') return res.end('{"data":{"id":"doc-1"}}');
    if (req.url === '/documents/img-1') return res.end('{"data":{"id":"img-1","currentVersion":{"versionNumber":2,"fileHash":"AB12"}}}');
    if (req.url === '/documents/blank') return res.end('{"data":{"id":"blank","currentVersion":null}}');
    res.end('{}');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  process.env.DOCUMENT_CENTER_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  process.env.DOCUMENT_CENTER_API_KEY = 'k';
});
after(() => server.close());

test('upload sends the contract: service headers, folder, base64 body keys', async () => {
  const { uploadDocument } = await import('./document-center');
  status = 201;
  const id = await uploadDocument({ organizationId: 'org-1', siteId: 'site-1', name: 'files/a.png', filename: 'a.png', mimeType: 'image/png', data: Buffer.from('hello') });
  assert.equal(id, 'doc-1');
  const upload = seen.find((s) => s.url === '/documents/service-upload')!;
  assert.equal(upload.method, 'POST');
  assert.equal(upload.key, 'k');
  assert.equal(upload.entity, 'org-1');
  assert.equal(upload.body.file, Buffer.from('hello').toString('base64'));
  assert.deepEqual([upload.body.filename, upload.body.mimeType, upload.body.name, upload.body.folderId], ['a.png', 'image/png', 'files/a.png', 'folder-1']);
  assert.deepEqual([upload.body.linkedEntityType, upload.body.linkedEntityId], ['CUSTOM', 'site-1']);
  const folder = seen.find((s) => s.url === '/folders' && s.method === 'POST')!;
  assert.deepEqual([folder.body.name, folder.body.isSystem], ['Web Studio', true]);
});

test('an empty file is refused before any call', async () => {
  const { uploadDocument } = await import('./document-center');
  const before = seen.length;
  await assert.rejects(uploadDocument({ organizationId: 'org-2', siteId: 's', name: 'n', filename: 'n', mimeType: 'image/png', data: Buffer.alloc(0) }), /empty/);
  assert.equal(seen.length, before);
});

test('a refusal from Document Center is an error carrying its status; delete treats 404 as done', async () => {
  const { deleteDocument, DocumentCenterError } = await import('./document-center');
  status = 401;
  await assert.rejects(deleteDocument('org-1', 'doc-1'), (e: unknown) => e instanceof DocumentCenterError && e.status === 401);
  status = 404;
  await deleteDocument('org-1', 'doc-1');
});

test('an item image is downloaded with its media type; a document read gives its current version\'s hash', async () => {
  const { currentFileHash, downloadDocumentFile } = await import('./document-center');
  status = 200;
  const file = await downloadDocumentFile('org-1', 'img-1');
  assert.deepEqual(file, { data: Buffer.from([0x89, 0x50, 0x4e, 0x47]), contentType: 'image/png' });
  const download = seen.find((s) => s.url === '/documents/img-1/download')!;
  assert.deepEqual([download.method, download.key, download.entity], ['GET', 'k', 'org-1']);
  assert.equal(await currentFileHash('org-1', 'img-1'), 'ab12');
  assert.equal(await currentFileHash('org-1', 'blank'), null);
  status = 404;
  assert.equal(await downloadDocumentFile('org-1', 'img-1'), null);
  assert.equal(await currentFileHash('org-1', 'img-1'), null);
  status = 503;
  await assert.rejects(currentFileHash('org-1', 'img-1'), /503/);
});
