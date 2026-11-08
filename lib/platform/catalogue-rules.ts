/**
 * What a published site sells, and how its pages see it (part 2, session W2;
 * PRD V1.1 "Catalogue", notebook decisions 14 and 16). Pure: the reads are
 * lib/platform/catalogue.ts's; this file decides and shapes.
 *
 * Eligibility, exactly:
 * - the item is ACTIVE and its own ECOMMERCE channel is on (the list it comes
 *   from, `GET /items?channel=ecommerce&status=ACTIVE`);
 * - a child row (`parent_item_id` set) is never a product of its own, even when
 *   it still has a channel row of its own (decision 14b);
 * - it is in one of the site's categories or under one of them, or the site
 *   chose none (OQ 10: a chosen category covers everything under it, ones added
 *   later included, so the tree is expanded at read time);
 * - it has a price: a base price that is not null and not 0 (decision 14a), in
 *   the site's currency or converted into it at the day's USD→IQD rate; no rate
 *   for the day, or a currency other than IQD and USD, is no price (never an
 *   error);
 * - a product with variants (`has_variants`) is the parent; each child is an
 *   option of it, available when it is ACTIVE and has a price, unavailable
 *   otherwise (kept, with the reason, for the picker to say so); the parent's
 *   own price is never used. Its price is the lowest available variant's, shown
 *   as "from". A parent with no available variant is not on sale (owner, 8 Nov
 *   2026, W2 grill-me): not in the grid, and the product route answers 404.
 *
 * Images are Document Center documents, served under the site host by
 * /store-media (lib/platform/store-media.ts). A variant with no image of its
 * own shows the product's (decision 16f); a product with none has no image and
 * the elements draw the token-colour tile (W4).
 *
 * Kept free of Next imports so it runs under `node --test`.
 */

import type { Unit } from '@/lib/platform/org-setup';
import type { CatalogueItem, CategoryNode, ItemImage, VariantWorkspace } from '@/lib/platform/product-services';
import { compareAmounts, convert, displayAmount, isPositive, type StoreCurrency } from '@/lib/platform/store-money';

/** A price as the buyer sees it, always in the site's currency. */
export interface Price {
  /** An exact decimal string: the base price itself, or the converted amount at the currency's precision. */
  amount: string;
  currency: StoreCurrency;
  /** True when the item is priced in the other currency and this is the conversion at the day's rate. */
  converted: boolean;
}

export interface ProductPrice extends Price {
  /** A product with variants: the lowest price among its available variants, shown as "from". */
  from: boolean;
}

export interface StoreImage {
  document_id: string;
  /** Relative to the site host: `/store-media/{documentId}?item={productId}`. */
  url: string;
}

export type UnavailableReason = 'inactive' | 'no_price' | 'no_rate';

export interface StoreVariantAxis {
  specification_id: string;
  option_id: string;
  name: string;
  name_ar: string | null;
  option: string;
  option_ar: string | null;
}

export interface StoreVariant {
  id: string;
  sku: string;
  /** Null when the variant cannot be bought. */
  price: Price | null;
  available: boolean;
  unavailable_reason: UnavailableReason | null;
  /** Its own image, else the product's; null when neither has one. */
  image: StoreImage | null;
  axes: StoreVariantAxis[];
}

export interface StoreAxis {
  id: string;
  code: string;
  name: string;
  name_ar: string | null;
  options: Array<{ id: string; code: string; label: string; label_ar: string | null }>;
}

export interface StoreProduct {
  id: string;
  sku: string;
  name: string;
  name_ar: string | null;
  description: string | null;
  description_ar: string | null;
  price: ProductPrice;
  unit: { name: string; symbol: string } | null;
  /** The primary image in a list; every product image on the product route. */
  images: StoreImage[];
  category: { id: string; name: string; name_ar: string | null } | null;
  /** Empty for a plain item. */
  variants: StoreVariant[];
  /** Empty for a plain item. */
  axes_summary: StoreAxis[];
}

export interface StoreCategorySummary {
  id: string;
  name: string;
  name_ar: string | null;
  /** The products the site sells in it and under it. */
  item_count: number;
  /** The image of the first of those products that has one; null when none has. */
  first_product_image: string | null;
}

export interface CatalogueInput {
  /** `GET /items?channel=ecommerce&status=ACTIVE`, every page. */
  items: CatalogueItem[];
  /** The workspace of each candidate with variants, by parent id; null when it is gone. */
  workspaces: Map<string, VariantWorkspace | null>;
  /** The live category tree. */
  tree: CategoryNode[];
  store: { currency: StoreCurrency; category_ids: string[] };
  /** The day's USD→IQD rate; null when there is none (or none was needed). */
  rate: string | null;
  units: Map<string, Unit>;
}

export interface Catalogue {
  currency: StoreCurrency;
  /** Eligible products in the grid's order (by name, then id). */
  products: StoreProduct[];
  byId: Map<string, StoreProduct>;
  /** Each variant of a product on sale, by its own item id, with its product: a cart line names the variant (session W3). */
  variantsById: Map<string, { product: StoreProduct; variant: StoreVariant }>;
  tree: CategoryNode[];
  /** The site's chosen categories, in their saved order. */
  chosen: string[];
}

export function imageUrl(documentId: string, productId: string): string {
  return `/store-media/${encodeURIComponent(documentId)}?item=${encodeURIComponent(productId)}`;
}

const image = (documentId: string | null, productId: string): StoreImage | null =>
  documentId ? { document_id: documentId, url: imageUrl(documentId, productId) } : null;

/** Every node of a tree by id. */
function index(nodes: CategoryNode[], into = new Map<string, CategoryNode>()): Map<string, CategoryNode> {
  for (const node of nodes) {
    into.set(node.id, node);
    index(node.children, into);
  }
  return into;
}

function addSubtree(node: CategoryNode, into: Set<string>): void {
  into.add(node.id);
  for (const child of node.children) addSubtree(child, into);
}

/** A category and every live category under it. An id the live tree does not hold (archived) stands for itself. */
export function subtreeIds(tree: CategoryNode[], ids: string[]): Set<string> {
  const live = index(tree);
  const set = new Set<string>();
  for (const id of ids) {
    const node = live.get(id);
    if (node) addSubtree(node, set);
    else set.add(id);
  }
  return set;
}

/** The categories a site sells from; null when it chose none (every category, and items with none). */
export function allowedCategories(tree: CategoryNode[], chosen: string[]): Set<string> | null {
  return chosen.length ? subtreeIds(tree, chosen) : null;
}

/** An item's price in the site's currency, or why it has none. */
export function priceFor(
  item: Pick<CatalogueItem, 'status' | 'base_price' | 'currency'>,
  siteCurrency: StoreCurrency,
  rate: string | null,
): { price: Price } | { reason: UnavailableReason } {
  if (item.status !== 'ACTIVE') return { reason: 'inactive' };
  if (item.base_price === null || !isPositive(item.base_price)) return { reason: 'no_price' };
  if (item.currency === siteCurrency) {
    return { price: { amount: displayAmount(item.base_price, siteCurrency), currency: siteCurrency, converted: false } };
  }
  if ((item.currency !== 'IQD' && item.currency !== 'USD') || rate === null) return { reason: 'no_rate' };
  return { price: { amount: convert(item.base_price, item.currency, siteCurrency, rate), currency: siteCurrency, converted: true } };
}

/** Whether a catalogue needs the day's rate: some candidate or variant is priced in the other currency. */
export function needsRate(items: Array<Pick<CatalogueItem, 'currency'>>, siteCurrency: StoreCurrency): boolean {
  return items.some((item) => item.currency !== siteCurrency && (item.currency === 'IQD' || item.currency === 'USD'));
}

/** The items that may be products: plain items and parents, ACTIVE, in the site's categories. Variants are read for the parents among them. */
export function candidatesOf(items: CatalogueItem[], tree: CategoryNode[], chosen: string[]): CatalogueItem[] {
  const allowed = allowedCategories(tree, chosen);
  return items.filter(
    (item) => item.parent_item_id === null && item.status === 'ACTIVE' && (allowed === null || (item.category_id !== null && allowed.has(item.category_id))),
  );
}

function toVariant(variant: VariantWorkspace['variants'][number], product: CatalogueItem, currency: StoreCurrency, rate: string | null): StoreVariant {
  const priced = priceFor(variant, currency, rate);
  return {
    id: variant.id,
    sku: variant.sku,
    price: 'price' in priced ? priced.price : null,
    available: 'price' in priced,
    unavailable_reason: 'reason' in priced ? priced.reason : null,
    image: image(variant.primary_image_document_id ?? product.primary_image_document_id, product.id),
    axes: variant.axes.map((axis) => ({
      specification_id: axis.specification_id,
      option_id: axis.option_id,
      name: axis.specification_name,
      name_ar: axis.specification_name_ar,
      option: axis.option_label,
      option_ar: axis.option_label_ar,
    })),
  };
}

function lowest(variants: StoreVariant[]): Price | null {
  let best: Price | null = null;
  for (const variant of variants) {
    if (variant.price && (!best || compareAmounts(variant.price.amount, best.amount) < 0)) best = variant.price;
  }
  return best;
}

function toProduct(item: CatalogueItem, input: CatalogueInput, categories: Map<string, CategoryNode>): StoreProduct | null {
  const { currency } = input.store;
  let price: ProductPrice;
  let variants: StoreVariant[] = [];
  let axes: StoreAxis[] = [];
  if (item.has_variants) {
    const workspace = input.workspaces.get(item.id);
    if (!workspace) return null; // gone between the list and its workspace
    variants = workspace.variants.filter((v) => v.parent_item_id === item.id).map((v) => toVariant(v, item, currency, input.rate));
    const from = lowest(variants);
    if (!from) return null; // no variant can be sold: the product is not on sale
    price = { ...from, from: true };
    axes = workspace.axes_summary.map((axis) => ({
      id: axis.specification_id,
      code: axis.specification_code,
      name: axis.specification_name,
      name_ar: axis.specification_name_ar,
      options: axis.options.map((option) => ({ ...option })),
    }));
  } else {
    const priced = priceFor(item, currency, input.rate);
    if (!('price' in priced)) return null;
    price = { ...priced.price, from: false };
  }
  const unit = item.base_uom_id ? input.units.get(item.base_uom_id) : undefined;
  const category = item.category_id ? categories.get(item.category_id) : undefined;
  const primary = image(item.primary_image_document_id, item.id);
  return {
    id: item.id,
    sku: item.sku,
    name: item.name,
    name_ar: item.name_ar,
    description: item.description,
    description_ar: item.description_ar,
    price,
    unit: unit ? { name: unit.name, symbol: unit.symbol } : null,
    images: primary ? [primary] : [],
    category: category ? { id: category.id, name: category.name, name_ar: category.name_ar } : null,
    variants,
    axes_summary: axes,
  };
}

const byName = (a: StoreProduct, b: StoreProduct) =>
  a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** The site's catalogue from what the services answered. */
export function buildCatalogue(input: CatalogueInput): Catalogue {
  const categories = index(input.tree);
  const products = candidatesOf(input.items, input.tree, input.store.category_ids)
    .map((item) => toProduct(item, input, categories))
    .filter((product): product is StoreProduct => product !== null)
    .sort(byName);
  return {
    currency: input.store.currency,
    products,
    byId: new Map(products.map((product) => [product.id, product])),
    variantsById: new Map(products.flatMap((product) => product.variants.map((variant) => [variant.id, { product, variant }] as const))),
    tree: input.tree,
    chosen: input.store.category_ids,
  };
}

const normalise = (text: string) => text.trim().toLocaleLowerCase();

export interface PageQuery {
  /** Products in this category or under it. */
  category?: string | null;
  /** Products in any of these categories or under them (a grid that lists chosen categories); not together with `category`. */
  categories?: string[] | null;
  /** Part of the name, in either language, any case. */
  search?: string | null;
  /** From 1. */
  page: number;
  pageSize: number;
}

/** One page of the grid. A page past the end is empty. */
export function pageOf(catalogue: Catalogue, query: PageQuery): { products: StoreProduct[]; total: number } {
  let products = catalogue.products;
  const roots = query.category ? [query.category] : query.categories ?? [];
  if (roots.length) {
    const ids = subtreeIds(catalogue.tree, roots);
    products = products.filter((product) => product.category !== null && ids.has(product.category.id));
  }
  const term = query.search ? normalise(query.search) : '';
  if (term) {
    products = products.filter((product) => normalise(product.name).includes(term) || (product.name_ar !== null && normalise(product.name_ar).includes(term)));
  }
  const start = (query.page - 1) * query.pageSize;
  return { products: products.slice(start, start + query.pageSize), total: products.length };
}

/**
 * The shop home's categories (OQ 8 and 9): the site's chosen ones that are
 * live, in their saved order, or the top-level categories when it chose none
 * (owner, 8 Nov 2026, W2 grill-me). Empty ones are listed with a count of 0.
 */
export function categorySummaries(catalogue: Catalogue): StoreCategorySummary[] {
  const live = index(catalogue.tree);
  const nodes = catalogue.chosen.length
    ? catalogue.chosen.map((id) => live.get(id)).filter((node): node is CategoryNode => node !== undefined)
    : catalogue.tree;
  return nodes.map((node) => {
    const ids = subtreeIds(catalogue.tree, [node.id]);
    const inside = catalogue.products.filter((product) => product.category !== null && ids.has(product.category.id));
    return {
      id: node.id,
      name: node.name,
      name_ar: node.name_ar,
      item_count: inside.length,
      first_product_image: inside.find((product) => product.images.length > 0)?.images[0].url ?? null,
    };
  });
}

/** A product with every image it has (the product route): its primary image first, then the others in their order. */
export function withImages(product: StoreProduct, images: ItemImage[]): StoreProduct {
  const ids = images.map((img) => img.document_id);
  const primary = product.images[0]?.document_id;
  if (primary && !ids.includes(primary)) ids.unshift(primary);
  return { ...product, images: ids.map((id) => ({ document_id: id, url: imageUrl(id, product.id) })) };
}

/** Whether a document is an image the product shows: its own, a variant's, or one of its gallery. */
export function showsImage(product: StoreProduct, documentId: string, gallery: ItemImage[] | null): boolean {
  if (product.images.some((img) => img.document_id === documentId)) return true;
  if (product.variants.some((variant) => variant.image?.document_id === documentId)) return true;
  return gallery?.some((img) => img.document_id === documentId) ?? false;
}
