/**
 * A stand-in for the platform services Web Studio calls with a service key, for
 * the e2e suite (part 2, session W1; W2 and W3 add their routes here). One
 * server, started by playwright.config.ts on E2E_PLATFORM_PORT (the app's port
 * + 3); the app's ORG_SETUP_URL and PRODUCT_SERVICES_URL both point at it.
 *
 * Organization Setup (auth-service), guarded by `x-service-api-key` alone:
 *   POST /api/internal/branches[/]        { entityId }  → the organization's active branches, a bare array
 *   POST /api/internal/branches/by-ids    { branchIds } → { branches }, archived included, no organization filter
 *
 * Product & Services, `x-service-api-key` (401) and `x-entity-id` (400):
 *   GET /categories/tree   { success, data }: the organization's live categories as a forest
 *   GET /categories/{id}   { success, data }: one of the organization's categories, archived included; 404 otherwise
 *
 * For the specs:
 *   GET  /__health
 *   POST /__down { services: ['org-setup' | 'product-services'] }  those answer 503 until the next call; [] restores
 *
 * The data is e2e/platform-fixtures.ts.
 */

import http from 'node:http';
import { BRANCHES, CATEGORIES, ORG_SETUP_KEY, PRODUCT_SERVICES_KEY, type FixtureCategory } from './platform-fixtures';

const PORT = Number(process.env.E2E_PLATFORM_PORT || 3105);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Service = 'org-setup' | 'product-services';
let down = new Set<Service>();

function json(response: http.ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

async function readJson(request: http.IncomingMessage): Promise<Record<string, unknown> | null> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    return value && typeof value === 'object' ? value : null;
  } catch {
    return null;
  }
}

/** A category as Product & Services serialises it (CategoryResponseSchema), with its children for the tree. */
function categoryResponse(category: FixtureCategory, depth: number, children?: unknown[]) {
  const childCount = CATEGORIES.filter((c) => c.parent_id === category.id && !c.archived).length;
  return {
    id: category.id,
    name: category.name,
    name_ar: category.name_ar,
    description: null,
    parent_id: category.parent_id,
    archived: category.archived,
    depth,
    effective_item_level: 2,
    is_folder: depth < 1,
    is_leaf: depth === 1,
    items_count: category.items_count,
    children_count: childCount,
    created_by: null,
    updated_by: null,
    created_at: '2026-11-01T00:00:00.000Z',
    updated_at: '2026-11-01T00:00:00.000Z',
    ...(children ? { children } : {}),
  };
}

function tree(entityId: string, parentId: string | null = null, depth = 0): unknown[] {
  return CATEGORIES.filter((c) => c.entityId === entityId && c.parent_id === parentId && !c.archived).map((c) =>
    categoryResponse(c, depth, tree(entityId, c.id, depth + 1)),
  );
}

async function orgSetup(request: http.IncomingMessage, response: http.ServerResponse, path: string): Promise<void> {
  if (request.headers['x-service-api-key'] !== ORG_SETUP_KEY) return json(response, 401, { error: 'Unauthorized', message: 'Invalid or missing service API key' });
  if (down.has('org-setup')) return json(response, 503, { error: 'Service Unavailable' });
  const body = await readJson(request);
  if (!body) return json(response, 400, { error: 'Bad Request', message: 'body must be JSON' });

  if (path === '/api/internal/branches/by-ids') {
    const ids = body.branchIds;
    if (!Array.isArray(ids) || !ids.every((id) => typeof id === 'string' && UUID.test(id))) return json(response, 400, { error: 'Bad Request', message: 'branchIds must be uuids' });
    return json(response, 200, { branches: BRANCHES.filter((b) => ids.includes(b.id)).map((b) => ({ ...b, parentBranchId: null })) });
  }
  const entityId = body.entityId;
  if (typeof entityId !== 'string' || !UUID.test(entityId)) return json(response, 400, { error: 'Bad Request', message: 'entityId must be a uuid' });
  return json(response, 200, BRANCHES.filter((b) => b.entityId === entityId && b.status === 'active').map((b) => ({ ...b, parentBranchId: null, city: null, phone: null })));
}

function productServices(request: http.IncomingMessage, response: http.ServerResponse, path: string): void {
  if (request.headers['x-service-api-key'] !== PRODUCT_SERVICES_KEY) return json(response, 401, { statusCode: 401, error: 'Unauthorized', message: 'Invalid service API key' });
  const entityId = request.headers['x-entity-id'];
  if (typeof entityId !== 'string' || !UUID.test(entityId)) return json(response, 400, { statusCode: 400, error: 'Bad Request', message: 'Missing required header: x-entity-id (UUID of the target entity).' });
  if (down.has('product-services')) return json(response, 503, { statusCode: 503, error: 'Service Unavailable' });

  if (path === '/categories/tree') return json(response, 200, { success: true, data: tree(entityId) });
  const id = path.slice('/categories/'.length);
  const category = CATEGORIES.find((c) => c.id === id && c.entityId === entityId);
  if (!category) return json(response, 404, { statusCode: 404, error: 'Not Found', message: `Category ${id} not found` });
  return json(response, 200, { success: true, data: categoryResponse(category, category.parent_id ? 1 : 0) });
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://127.0.0.1:${PORT}`);
  const path = url.pathname;
  try {
    if (path === '/__health') return json(response, 200, { ok: true });
    if (path === '/__down' && request.method === 'POST') {
      const body = await readJson(request);
      const services = Array.isArray(body?.services) ? (body!.services as Service[]) : [];
      down = new Set(services);
      return json(response, 200, { down: [...down] });
    }
    if (request.method === 'POST' && (path === '/api/internal/branches' || path === '/api/internal/branches/' || path === '/api/internal/branches/by-ids')) {
      return await orgSetup(request, response, path);
    }
    if (request.method === 'GET' && path.startsWith('/categories/')) return productServices(request, response, path);
    return json(response, 404, { error: 'Not Found', message: `No route ${request.method} ${path}` });
  } catch (error) {
    return json(response, 500, { error: 'Stub failure', message: error instanceof Error ? error.message : String(error) });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`e2e platform stub listening on http://127.0.0.1:${PORT}`);
});
