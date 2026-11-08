/**
 * The query of `GET /ycode/api/store/products` (part 2, session W2): what the
 * product grid element sends. Kept free of Next imports so it runs under
 * `node --test`.
 *
 *   category    a category id: products in it and under it (the shop home's
 *               category cards link to the products page with ?category={id})
 *   categories  1 to 24 category ids separated by commas: products in any of them or under
 *               them (a product grid that lists chosen categories, W4); not together with category
 *   q           part of a product's name, in either language (200 characters at most, as Product & Services' own search)
 *   page        from 1, default 1
 *   page_size   1 to 48, default 12 (the element's setting)
 */

import type { PageQuery } from '@/lib/platform/catalogue-rules';

export const MAX_PAGE_SIZE = 48;
export const DEFAULT_PAGE_SIZE = 12;
const MAX_SEARCH = 200;
export const MAX_CATEGORIES = 24;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WHOLE = /^\d{1,9}$/;

export function isUuid(value: string | null | undefined): value is string {
  return typeof value === 'string' && UUID.test(value);
}

export function parseProductsQuery(params: URLSearchParams): { query: PageQuery } | { errors: string[] } {
  const errors: string[] = [];
  const known = new Set(['category', 'categories', 'q', 'page', 'page_size']);
  for (const key of new Set(params.keys())) {
    if (!known.has(key)) errors.push(`${key} is not a filter of the products list`);
    else if (params.getAll(key).length > 1) errors.push(`${key} is given more than once`);
  }

  const number = (key: string, fallback: number, max: number): number => {
    const raw = params.get(key);
    if (raw === null) return fallback;
    if (!WHOLE.test(raw) || Number(raw) < 1 || Number(raw) > max) {
      errors.push(`${key} must be a whole number from 1 to ${max}`);
      return fallback;
    }
    return Number(raw);
  };
  const page = number('page', 1, 1_000_000);
  const pageSize = number('page_size', DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);

  const category = params.get('category');
  if (category !== null && !isUuid(category)) errors.push('category must be a category id');
  let categories: string[] | null = null;
  const listed = params.get('categories');
  if (listed !== null) {
    const ids = listed.split(',').map((id) => id.trim());
    if (category !== null) errors.push('give category or categories, not both');
    else if (ids.length > MAX_CATEGORIES || ids.some((id) => !isUuid(id))) errors.push(`categories must be 1 to ${MAX_CATEGORIES} category ids separated by commas`);
    else categories = [...new Set(ids.map((id) => id.toLowerCase()))];
  }
  const search = params.get('q')?.trim() ?? '';
  if (search.length > MAX_SEARCH) errors.push(`q must be ${MAX_SEARCH} characters at most`);

  if (errors.length) return { errors };
  return { query: { category: category?.toLowerCase() ?? null, ...(categories ? { categories } : {}), search: search || null, page, pageSize } };
}
