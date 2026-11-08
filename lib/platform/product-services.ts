/**
 * Product & Services client (part 2, session W1): the organization's category
 * tree. Items are session W2's.
 *
 * From the live spec (`https://products-services.torchcorp.com/documentation/json`,
 * checked 8 Nov 2026) and the service's routes: every call carries
 * `x-service-api-key` (Product & Services' SERVICE_API_KEY) and `x-entity-id`
 * (the organization; without it a service call is 400). The envelope is
 * `{ success: true, data }`.
 *
 *   GET /categories/tree   the live (not archived) categories as a forest; each
 *        node has id, name, name_ar, parent_id, depth, is_leaf, items_count and
 *        children. A live category under an archived one is surfaced at the root.
 *        `items_count` counts the items assigned to that category itself, every
 *        status, variants included; items sit on leaf categories only.
 *   GET /categories/{id}   one category of the organization, archived ones
 *        included; 404 when it is not the organization's or does not exist.
 *
 * A site's chosen category covers every category under it (owner, 8 Nov 2026),
 * so the store's counts are summed up the tree here (`rollUpTree`).
 *
 * PRODUCT_SERVICES_URL and PRODUCT_SERVICES_API_KEY come from the environment.
 * Kept free of Next imports so it runs under `node --test`.
 */

/** A category as the tree route answers it (the fields Web Studio reads). */
export interface CategoryNode {
  id: string;
  name: string;
  name_ar: string | null;
  parent_id: string | null;
  archived: boolean;
  items_count: number;
  children: CategoryNode[];
}

/** A category as the store settings show it: the count covers the category and everything under it. */
export interface StoreCategoryNode {
  id: string;
  name: string;
  name_ar: string | null;
  item_count: number;
  children: StoreCategoryNode[];
}

/** One category read by id. */
export interface Category {
  id: string;
  name: string;
  name_ar: string | null;
  archived: boolean;
  items_count: number;
}

/** Product & Services is not configured, cannot be reached, or did not answer as its spec says. */
export class ProductServicesUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProductServicesUnavailableError';
  }
}

type Env = Record<string, string | undefined>;

const TIMEOUT_MS = 5_000;

function config(env: Env): { baseUrl: string; apiKey: string } {
  const baseUrl = env.PRODUCT_SERVICES_URL?.trim().replace(/\/+$/, '');
  const apiKey = env.PRODUCT_SERVICES_API_KEY?.trim();
  if (!baseUrl || !apiKey) throw new ProductServicesUnavailableError('PRODUCT_SERVICES_URL and PRODUCT_SERVICES_API_KEY are not set');
  return { baseUrl, apiKey };
}

/** GET a path; null on 404 when `notFoundIsNull`, the `data` of the envelope otherwise. */
async function getData(op: string, organizationId: string, path: string, env: Env, fetchImpl: typeof fetch, notFoundIsNull = false): Promise<unknown> {
  const { baseUrl, apiKey } = config(env);
  let response: Response;
  try {
    response = await fetchImpl(`${baseUrl}${path}`, {
      headers: { 'x-service-api-key': apiKey, 'x-entity-id': organizationId },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    throw new ProductServicesUnavailableError(`Product & Services is not reachable (${op}): ${error instanceof Error ? error.message : String(error)}`);
  }
  if (notFoundIsNull && response.status === 404) return null;
  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 200);
    throw new ProductServicesUnavailableError(`Product & Services answered ${response.status} to ${op}${detail ? `: ${detail}` : ''}`);
  }
  const body = (await response.json().catch(() => undefined)) as { success?: unknown; data?: unknown } | undefined;
  if (!body || body.success !== true || body.data === undefined) {
    throw new ProductServicesUnavailableError(`Product & Services answered ${op} with an unexpected body`);
  }
  return body.data;
}

const isText = (value: unknown): value is string => typeof value === 'string';
const optionalText = (value: unknown): string | null => (isText(value) && value.trim() ? value : null);

function toCategory(op: string, raw: unknown): Category & { parent_id: string | null; children: unknown } {
  const value = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  if (!isText(value.id) || !isText(value.name) || typeof value.items_count !== 'number') {
    throw new ProductServicesUnavailableError(`Product & Services answered ${op} with a category that has no id, name or items_count`);
  }
  return {
    id: value.id,
    name: value.name,
    name_ar: optionalText(value.name_ar),
    parent_id: isText(value.parent_id) ? value.parent_id : null,
    archived: value.archived === true,
    items_count: value.items_count,
    children: value.children,
  };
}

function toNode(op: string, raw: unknown): CategoryNode {
  const category = toCategory(op, raw);
  const children = category.children === undefined ? [] : category.children;
  if (!Array.isArray(children)) throw new ProductServicesUnavailableError(`Product & Services answered ${op} with children that are not a list`);
  return {
    id: category.id,
    name: category.name,
    name_ar: category.name_ar,
    parent_id: category.parent_id,
    archived: category.archived,
    items_count: category.items_count,
    children: children.map((child) => toNode(op, child)),
  };
}

/** The organization's live category tree. */
export async function getCategoryTree(organizationId: string, env: Env = process.env, fetchImpl: typeof fetch = fetch): Promise<CategoryNode[]> {
  const op = 'GET /categories/tree';
  const data = await getData(op, organizationId, '/categories/tree', env, fetchImpl);
  if (!Array.isArray(data)) throw new ProductServicesUnavailableError(`Product & Services answered ${op} with data that is not a list`);
  return data.map((node) => toNode(op, node));
}

/** One category of the organization, archived or not; null when it is not the organization's. */
export async function getCategory(organizationId: string, id: string, env: Env = process.env, fetchImpl: typeof fetch = fetch): Promise<Category | null> {
  const op = 'GET /categories/{id}';
  const data = await getData(op, organizationId, `/categories/${encodeURIComponent(id)}`, env, fetchImpl, true);
  if (data === null) return null;
  const { children: _children, parent_id: _parent, ...category } = toCategory(op, data);
  return category;
}

/** The tree as the store settings' picker shows it: each count is the category's own plus everything under it. */
export function rollUpTree(nodes: CategoryNode[]): StoreCategoryNode[] {
  return nodes.map((node) => {
    const children = rollUpTree(node.children);
    return {
      id: node.id,
      name: node.name,
      name_ar: node.name_ar,
      item_count: node.items_count + children.reduce((sum, child) => sum + child.item_count, 0),
      children,
    };
  });
}

/** Every node of a store tree by id. */
export function indexTree(nodes: StoreCategoryNode[], into = new Map<string, StoreCategoryNode>()): Map<string, StoreCategoryNode> {
  for (const node of nodes) {
    into.set(node.id, node);
    indexTree(node.children, into);
  }
  return into;
}
