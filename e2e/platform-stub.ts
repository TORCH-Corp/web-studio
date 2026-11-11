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
 * Organization Setup, `x-service-api-key` (401) and `x-entity-id` (400) (session W2):
 *   GET  /api/internal/org-setup/exchange-rates/as-of?from&to&date&rate_type
 *        { success, data: { found, rate, … } }: USD→IQD at USD_IQD_RATE while the stub has a rate; never inverted
 *   POST /api/internal/org-setup/uoms/lookup  { ids }  → { success, data: units }
 *
 * Product & Services, `x-service-api-key` (401) and `x-entity-id` (400):
 *   GET /categories/tree   { success, data }: the organization's live categories as a forest
 *   GET /categories/{id}   { success, data }: one of the organization's categories, archived included; 404 otherwise
 *   GET /items?status&channel&limit&offset            { success, data, meta } (session W2), the row's own channel
 *   GET /items/{id}/variants/workspace                { success, data: { parent, axes_summary, variant_count, variants } }
 *   GET /items/{id}/documents                         { success, data: { product_image: [...], … } }
 *
 * Contact Center's find-or-create and Sales's service create and order read
 * (session W3) are e2e/order-services-stub.ts, which records every call.
 * Notification Center's create, and Organization Setup's member list and permission
 * evaluate (part 3, session W5), are e2e/notification-stub.ts, which records every call too.
 *
 * For the specs:
 *   GET  /__health
 *   POST /__down { services: ['org-setup' | 'product-services' | 'contact-center' | 'sales' | 'notification'] }
 *        those answer 503 until the next call; [] restores
 *   POST /__rate { found: boolean }   whether Organization Setup has the day's rate (Sales's stub reads it too)
 *   POST /__item { id, status?, base_price? }   changes an item of the catalogue (session W6): Product & Services and
 *        Sales's stub both read it, so "the item turned inactive" or "the price changed" is what both say next;
 *        POST /__items/reset puts every item back as the fixtures have it
 *   GET  /__calls?service=…, POST /__sales/refuse, POST /__sales/delay  (order-services-stub.ts)
 *   GET  /__calls?service=notification|org-setup, POST /__notification/delay  (notification-stub.ts)
 *
 * The data is e2e/platform-fixtures.ts.
 */

import http from 'node:http';
import {
  BRANCHES,
  CATEGORIES,
  DOCUMENTS,
  ITEMS,
  ORG_SETUP_KEY,
  PRODUCT_SERVICES_KEY,
  SPECIFICATIONS,
  UNITS,
  USD_IQD_RATE,
  type FixtureCategory,
  type FixtureItem,
} from './platform-fixtures';
import { handleNotificationServices, type NotificationService } from './notification-stub';
import { handleOrderServices, type OrderService } from './order-services-stub';

const PORT = Number(process.env.E2E_PLATFORM_PORT || 3105);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Service = 'org-setup' | 'product-services' | OrderService | NotificationService;
let down = new Set<Service>();
let rateFound = true;
/** The items as the fixtures have them, for `/__items/reset`. */
const PRISTINE_ITEMS = ITEMS.map((item) => ({ ...item }));

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

/** The two Organization Setup reads of session W2: they act in the organization of x-entity-id. */
async function orgSetupInOrganization(request: http.IncomingMessage, response: http.ServerResponse, url: URL): Promise<void> {
  if (request.headers['x-service-api-key'] !== ORG_SETUP_KEY) return json(response, 401, { error: 'Unauthorized', message: 'Invalid or missing service API key' });
  const entityId = request.headers['x-entity-id'];
  if (typeof entityId !== 'string' || !UUID.test(entityId)) return json(response, 400, { error: 'Bad Request', message: 'x-entity-id must be a uuid' });
  if (down.has('org-setup')) return json(response, 503, { error: 'Service Unavailable' });

  if (url.pathname === '/api/internal/org-setup/exchange-rates/as-of') {
    const q = url.searchParams;
    const [from, to, date, rateType] = [q.get('from'), q.get('to'), q.get('date'), q.get('rate_type')];
    if (!from || from.length !== 3 || !to || to.length !== 3 || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || (rateType !== 'spot' && rateType !== 'closing')) {
      return json(response, 400, { error: 'Bad Request', message: 'from, to, date and rate_type are required' });
    }
    if (rateFound && from === 'USD' && to === 'IQD') {
      return json(response, 200, { success: true, data: { found: true, rate_type: rateType, rate: USD_IQD_RATE, effective_date: '2026-10-17', source: 'manual' } });
    }
    return json(response, 200, { success: true, data: { found: false, rate_type: rateType, from, to, as_of: date } });
  }
  const body = await readJson(request);
  const ids = body?.ids;
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > 200 || !ids.every((id) => typeof id === 'string' && UUID.test(id))) {
    return json(response, 400, { error: 'Bad Request', message: 'ids must be 1 to 200 uuids' });
  }
  return json(response, 200, { success: true, data: UNITS.filter((u) => u.entityId === entityId && ids.includes(u.id)).map(({ entityId: _entity, ...unit }) => unit) });
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

const children = (item: FixtureItem) => ITEMS.filter((child) => child.parent_item_id === item.id);

/** An item as Product & Services serialises it (ItemResponseSchema plus the list's joins), internal fields included as the live service sends them. */
function itemResponse(item: FixtureItem) {
  const variants = children(item);
  return {
    id: item.id, type: 'PRODUCT_STOCKABLE', name: item.name, name_ar: item.name_ar, sku: item.sku, item_code: null,
    description: item.description, description_ar: item.description_ar, status: item.status, base_uom_id: item.base_uom_id,
    base_price: item.base_price, initial_cost: 1000, currency: item.currency, category_id: item.category_id,
    parent_item_id: item.parent_item_id, brand_id: null, bundle_type: null, primary_image_id: item.primary_image ? `img-row-${item.id}` : null,
    primary_image_url: item.primary_image ? `/items/${item.id}/documents/${item.primary_image}/content` : null,
    has_variants: variants.length > 0, variant_count: variants.length,
    active_variant_count: variants.filter((v) => v.status === 'ACTIVE').length, inactive_variant_count: variants.filter((v) => v.status !== 'ACTIVE').length,
    search_name: item.name, alias_names: [], replacement_item_id: null, tax_code_id: null, hs_code: null, version: 1,
    approval_chain_id: null, approval_status: null, created_by: '00000000-0000-0000-0000-000000000001', updated_by: null,
    created_at: '2026-11-01T00:00:00.000Z', updated_at: '2026-11-01T00:00:00.000Z',
  };
}

function variantAxes(item: FixtureItem) {
  return item.axes.map(({ specification_id, option_id }) => {
    const spec = SPECIFICATIONS.find((s) => s.id === specification_id)!;
    const option = spec.options.find((o) => o.id === option_id)!;
    return { specification_id, specification_name: spec.name, specification_name_ar: spec.name_ar, option_id, option_code: option.code, option_label: option.label, option_label_ar: option.label_ar };
  });
}

function items(response: http.ServerResponse, entityId: string, query: URLSearchParams): void {
  const list = (key: string) => query.getAll(key).flatMap((v) => v.split(',')).filter(Boolean);
  const statuses = list('status');
  const channels = list('channel');
  const limit = Number(query.get('limit') ?? 50);
  const offset = Number(query.get('offset') ?? 0);
  if (!Number.isInteger(limit) || limit < 1 || limit > 200 || !Number.isInteger(offset) || offset < 0) {
    return json(response, 400, { statusCode: 400, error: 'Bad Request', message: 'querystring/limit must be <= 200' });
  }
  if (channels.some((c) => c !== 'ecommerce')) return json(response, 400, { statusCode: 400, error: 'Bad Request', message: 'the stub knows the ecommerce channel only' });
  const rows = ITEMS.filter((item) => item.entityId === entityId && (!statuses.length || statuses.includes(item.status)) && (!channels.length || item.ecommerce));
  return json(response, 200, { success: true, data: rows.slice(offset, offset + limit).map(itemResponse), meta: { total: rows.length, limit, offset } });
}

function productServices(request: http.IncomingMessage, response: http.ServerResponse, path: string, query: URLSearchParams = new URLSearchParams()): void {
  if (request.headers['x-service-api-key'] !== PRODUCT_SERVICES_KEY) return json(response, 401, { statusCode: 401, error: 'Unauthorized', message: 'Invalid service API key' });
  const entityId = request.headers['x-entity-id'];
  if (typeof entityId !== 'string' || !UUID.test(entityId)) return json(response, 400, { statusCode: 400, error: 'Bad Request', message: 'Missing required header: x-entity-id (UUID of the target entity).' });
  if (down.has('product-services')) return json(response, 503, { statusCode: 503, error: 'Service Unavailable' });

  if (path === '/items') return items(response, entityId, query);
  const itemRoute = path.match(/^\/items\/([0-9a-f-]{36})\/(variants\/workspace|documents)$/);
  if (itemRoute) {
    const item = ITEMS.find((i) => i.id === itemRoute[1] && i.entityId === entityId);
    if (!item) return json(response, 404, { statusCode: 404, error: 'Not Found', message: `Item ${itemRoute[1]} not found` });
    if (itemRoute[2] === 'documents') {
      const image = DOCUMENTS.find((d) => d.id === item.primary_image);
      const productImages = image ? [{
        id: image.id, link_id: `link-${image.id}`, document_id: image.id, file_name: image.filename, link_type: 'product_image',
        url: `/items/${item.id}/documents/${image.id}/content`, title: null, content_type: image.mimeType, size: Buffer.from(image.base64, 'base64').length,
        uploaded_by: '00000000-0000-0000-0000-000000000001', uploaded_by_name: null, uploaded_at: '2026-11-01T00:00:00.000Z',
        image_id: `img-row-${item.id}`, is_primary: true, order_index: 0,
      }] : [];
      return json(response, 200, { success: true, data: { product_image: productImages, specification: [], user_manual: [], certification: [], safety_data_sheet: [], approval_record: [], external_link: [] } });
    }
    const variants = children(item);
    const used = SPECIFICATIONS.filter((spec) => variants.some((v) => v.axes.some((a) => a.specification_id === spec.id))).map((spec) => ({
      specification_id: spec.id, specification_code: spec.code, specification_name: spec.name, specification_name_ar: spec.name_ar,
      options: spec.options.filter((o) => variants.some((v) => v.axes.some((a) => a.option_id === o.id))).map((o) => ({ id: o.id, code: o.code, label: o.label, label_ar: o.label_ar })),
    }));
    return json(response, 200, {
      success: true,
      data: { parent: itemResponse(item), axes_summary: used, variant_count: variants.length, variants: variants.map((v) => ({ ...itemResponse(v), primary_barcode: null, axes: variantAxes(v) })) },
    });
  }
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
    if (path === '/__item' && request.method === 'POST') {
      const body = await readJson(request);
      const item = ITEMS.find((candidate) => candidate.id === body?.id);
      if (!item) return json(response, 404, { error: 'No such item', id: body?.id ?? null });
      if (body?.status === 'ACTIVE' || body?.status === 'INACTIVE' || body?.status === 'DISCONTINUED') item.status = body.status;
      if (typeof body?.base_price === 'number' || body?.base_price === null) item.base_price = body.base_price;
      return json(response, 200, { id: item.id, status: item.status, base_price: item.base_price });
    }
    if (path === '/__items/reset' && request.method === 'POST') {
      for (const pristine of PRISTINE_ITEMS) Object.assign(ITEMS.find((item) => item.id === pristine.id)!, pristine);
      return json(response, 200, { reset: PRISTINE_ITEMS.length });
    }
    if (path === '/__rate' && request.method === 'POST') {
      rateFound = (await readJson(request))?.found !== false;
      return json(response, 200, { found: rateFound });
    }
    if (request.method === 'POST' && (path === '/api/internal/branches' || path === '/api/internal/branches/' || path === '/api/internal/branches/by-ids')) {
      return await orgSetup(request, response, path);
    }
    if ((request.method === 'GET' && path === '/api/internal/org-setup/exchange-rates/as-of') || (request.method === 'POST' && path === '/api/internal/org-setup/uoms/lookup')) {
      return await orgSetupInOrganization(request, response, url);
    }
    if (request.method === 'GET' && (path.startsWith('/categories/') || path === '/items' || path.startsWith('/items/'))) return productServices(request, response, path, url.searchParams);
    if (await handleNotificationServices(request, response, url, (service) => down.has(service), json)) return;
    if (await handleOrderServices(request, response, url, (service) => down.has(service), () => rateFound, json)) return;
    return json(response, 404, { error: 'Not Found', message: `No route ${request.method} ${path}` });
  } catch (error) {
    return json(response, 500, { error: 'Stub failure', message: error instanceof Error ? error.message : String(error) });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`e2e platform stub listening on http://127.0.0.1:${PORT}`);
});
