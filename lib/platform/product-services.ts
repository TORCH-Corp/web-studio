/**
 * Product & Services client: the organization's category tree (part 2,
 * session W1) and the items a storefront reads (session W2).
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
 *   GET /items?channel=ecommerce&status=ACTIVE&limit&offset   the items whose
 *        own ECOMMERCE channel row is active, `{ success, data, meta: { total,
 *        limit, offset } }`, limit 200 at most. After the Product & Services
 *        light path (session P1) only parents and plain items carry channel
 *        rows; a child row that still has one is dropped by the catalogue.
 *        `base_price` is a number or null; `primary_image_url` is
 *        `/items/{id}/documents/{documentId}/content`, the service's own proxy,
 *        whose document id is what Web Studio fetches from Document Center.
 *   GET /items/{id}/variants/workspace   `{ parent, axes_summary, variant_count,
 *        variants }`: the axes with their options and every child with its own
 *        status, price, currency, image and `axes` (the parent is the list's row,
 *        so `parent` is not read). P1 adds the Arabic names
 *        (`specification_name_ar`, `option_label_ar`, `label_ar`); before it
 *        they are absent and read as null.
 *   GET /items/{id}/documents   the item's documents grouped by link type; the
 *        `product_image` group is its images (`document_id`, `is_primary`,
 *        `order_index`; the media type is the download's).
 *
 * A site's chosen category covers every category under it (owner, 8 Nov 2026),
 * so the store's counts are summed up the tree here (`rollUpTree`).
 *
 * PRODUCT_SERVICES_URL and PRODUCT_SERVICES_API_KEY come from the environment.
 * Kept free of Next imports so it runs under `node --test`.
 */

import { decimalFromNumber } from '@/lib/platform/store-money';

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

/** GET a path; null on 404 when `notFoundIsNull`, the envelope `{ success: true, data, … }` otherwise. */
async function getEnvelope(op: string, organizationId: string, path: string, env: Env, fetchImpl: typeof fetch, notFoundIsNull = false): Promise<Record<string, unknown> | null> {
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
  const body = (await response.json().catch(() => undefined)) as Record<string, unknown> | undefined;
  if (!body || body.success !== true || body.data === undefined) {
    throw new ProductServicesUnavailableError(`Product & Services answered ${op} with an unexpected body`);
  }
  return body;
}

/** GET a path; null on 404 when `notFoundIsNull`, the `data` of the envelope otherwise. */
async function getData(op: string, organizationId: string, path: string, env: Env, fetchImpl: typeof fetch, notFoundIsNull = false): Promise<unknown> {
  const body = await getEnvelope(op, organizationId, path, env, fetchImpl, notFoundIsNull);
  return body === null ? null : body.data;
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

// ---------------------------------------------------------------------------
// Items (part 2, session W2)
// ---------------------------------------------------------------------------

/** An item as the storefront reads it (a row of GET /items, a workspace's parent or variant): the fields Web Studio uses, nothing internal. */
export interface CatalogueItem {
  id: string;
  sku: string;
  name: string;
  name_ar: string | null;
  description: string | null;
  description_ar: string | null;
  status: string;
  /** The base price as an exact decimal string; null when the item has none. */
  base_price: string | null;
  currency: string;
  category_id: string | null;
  parent_item_id: string | null;
  has_variants: boolean;
  base_uom_id: string | null;
  /** The Document Center document of the item's primary image; null when it has none. */
  primary_image_document_id: string | null;
}

/** One axis value of a variant (Size = M). */
export interface VariantAxis {
  specification_id: string;
  specification_name: string;
  specification_name_ar: string | null;
  option_id: string;
  option_label: string;
  option_label_ar: string | null;
}

export interface CatalogueVariant extends CatalogueItem {
  axes: VariantAxis[];
}

/** One axis of a product with variants, with every option it has. */
export interface AxisSummary {
  specification_id: string;
  specification_code: string;
  specification_name: string;
  specification_name_ar: string | null;
  options: Array<{ id: string; code: string; label: string; label_ar: string | null }>;
}

export interface VariantWorkspace {
  axes_summary: AxisSummary[];
  variants: CatalogueVariant[];
}

/** One image of an item: a Document Center document. */
export interface ItemImage {
  document_id: string;
  is_primary: boolean;
  order_index: number;
}

/** GET /items takes 200 rows at most per page. */
const ITEMS_PAGE = 200;
const IMAGE_PATH = /^\/items\/[^/]+\/documents\/([0-9a-f-]{36})\/content$/i;

function record(op: string, raw: unknown, what: string): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new ProductServicesUnavailableError(`Product & Services answered ${op} with ${what} that is not an object`);
  return raw as Record<string, unknown>;
}

function requiredText(op: string, value: Record<string, unknown>, key: string, what: string): string {
  const text = value[key];
  if (!isText(text) || !text) throw new ProductServicesUnavailableError(`Product & Services answered ${op} with ${what} that has no ${key}`);
  return text;
}

function basePrice(op: string, value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const price = decimalFromNumber(value, 4);
  if (price === null) throw new ProductServicesUnavailableError(`Product & Services answered ${op} with a base_price that is not a number zero or above`);
  return price;
}

function toItem(op: string, raw: unknown): CatalogueItem {
  const value = record(op, raw, 'an item');
  const imageUrl = optionalText(value.primary_image_url);
  return {
    id: requiredText(op, value, 'id', 'an item'),
    sku: requiredText(op, value, 'sku', 'an item'),
    name: requiredText(op, value, 'name', 'an item'),
    name_ar: optionalText(value.name_ar),
    description: optionalText(value.description),
    description_ar: optionalText(value.description_ar),
    status: requiredText(op, value, 'status', 'an item'),
    base_price: basePrice(op, value.base_price),
    currency: requiredText(op, value, 'currency', 'an item').toUpperCase(),
    category_id: optionalText(value.category_id),
    parent_item_id: optionalText(value.parent_item_id),
    has_variants: value.has_variants === true,
    base_uom_id: optionalText(value.base_uom_id),
    primary_image_document_id: imageUrl ? (imageUrl.match(IMAGE_PATH)?.[1] ?? null) : null,
  };
}

function toAxis(op: string, raw: unknown): VariantAxis {
  const value = record(op, raw, 'a variant axis');
  return {
    specification_id: requiredText(op, value, 'specification_id', 'a variant axis'),
    specification_name: requiredText(op, value, 'specification_name', 'a variant axis'),
    specification_name_ar: optionalText(value.specification_name_ar),
    option_id: requiredText(op, value, 'option_id', 'a variant axis'),
    option_label: requiredText(op, value, 'option_label', 'a variant axis'),
    option_label_ar: optionalText(value.option_label_ar),
  };
}

function toAxisSummary(op: string, raw: unknown): AxisSummary {
  const value = record(op, raw, 'an axis');
  if (!Array.isArray(value.options)) throw new ProductServicesUnavailableError(`Product & Services answered ${op} with an axis whose options are not a list`);
  return {
    specification_id: requiredText(op, value, 'specification_id', 'an axis'),
    specification_code: requiredText(op, value, 'specification_code', 'an axis'),
    specification_name: requiredText(op, value, 'specification_name', 'an axis'),
    specification_name_ar: optionalText(value.specification_name_ar),
    options: value.options.map((rawOption) => {
      const option = record(op, rawOption, 'an axis option');
      return {
        id: requiredText(op, option, 'id', 'an axis option'),
        code: requiredText(op, option, 'code', 'an axis option'),
        label: requiredText(op, option, 'label', 'an axis option'),
        label_ar: optionalText(option.label_ar),
      };
    }),
  };
}

/**
 * Every ACTIVE item of the organization whose own ECOMMERCE channel is on,
 * every page of GET /items, in Product & Services' order.
 */
export async function listEcommerceItems(organizationId: string, env: Env = process.env, fetchImpl: typeof fetch = fetch): Promise<CatalogueItem[]> {
  const op = 'GET /items?channel=ecommerce&status=ACTIVE';
  const items: CatalogueItem[] = [];
  for (let offset = 0; ; offset += ITEMS_PAGE) {
    const query = new URLSearchParams({ channel: 'ecommerce', status: 'ACTIVE', limit: String(ITEMS_PAGE), offset: String(offset) });
    const body = (await getEnvelope(op, organizationId, `/items?${query}`, env, fetchImpl))!;
    const meta = body.meta as { total?: unknown } | undefined;
    if (!Array.isArray(body.data) || typeof meta?.total !== 'number') {
      throw new ProductServicesUnavailableError(`Product & Services answered ${op} without a list and its total`);
    }
    items.push(...body.data.map((row) => toItem(op, row)));
    if (items.length >= meta.total) return items;
    // A page that adds nothing before the total is reached would loop forever: the list changed under us or the service misreports.
    if (body.data.length === 0) throw new ProductServicesUnavailableError(`Product & Services answered ${op} with an empty page at offset ${offset} of ${meta.total}`);
  }
}

/** A product with variants: its axes and every child; null when it is not an item of the organization. */
export async function getVariantWorkspace(organizationId: string, parentId: string, env: Env = process.env, fetchImpl: typeof fetch = fetch): Promise<VariantWorkspace | null> {
  const op = 'GET /items/{id}/variants/workspace';
  const data = await getData(op, organizationId, `/items/${encodeURIComponent(parentId)}/variants/workspace`, env, fetchImpl, true);
  if (data === null) return null;
  const value = record(op, data, 'a workspace');
  if (!Array.isArray(value.axes_summary) || !Array.isArray(value.variants)) {
    throw new ProductServicesUnavailableError(`Product & Services answered ${op} without axes_summary and variants lists`);
  }
  return {
    axes_summary: value.axes_summary.map((axis) => toAxisSummary(op, axis)),
    variants: value.variants.map((raw) => {
      const variant = record(op, raw, 'a variant');
      if (!Array.isArray(variant.axes)) throw new ProductServicesUnavailableError(`Product & Services answered ${op} with a variant whose axes are not a list`);
      return { ...toItem(op, variant), axes: variant.axes.map((axis) => toAxis(op, axis)) };
    }),
  };
}

/** An item's images (its `product_image` documents), the primary first, then in their order; null when it is not an item of the organization. */
export async function listItemImages(organizationId: string, itemId: string, env: Env = process.env, fetchImpl: typeof fetch = fetch): Promise<ItemImage[] | null> {
  const op = 'GET /items/{id}/documents';
  const data = await getData(op, organizationId, `/items/${encodeURIComponent(itemId)}/documents`, env, fetchImpl, true);
  if (data === null) return null;
  const groups = record(op, data, 'the documents');
  const images = groups.product_image === undefined ? [] : groups.product_image;
  if (!Array.isArray(images)) throw new ProductServicesUnavailableError(`Product & Services answered ${op} with product_image that is not a list`);
  return images
    .map((raw): ItemImage => {
      const value = record(op, raw, 'a document');
      return {
        document_id: requiredText(op, value, 'document_id', 'a document'),
        is_primary: value.is_primary === true,
        order_index: typeof value.order_index === 'number' ? value.order_index : 0,
      };
    })
    .sort((a, b) => Number(b.is_primary) - Number(a.is_primary) || a.order_index - b.order_index);
}
