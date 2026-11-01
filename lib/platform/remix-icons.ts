/**
 * Remix icons served by the platform (part 1, session 3).
 *
 * The icon picker used to call ycode's hosted icons API. The same icon set is
 * now a file in the repository (data/remix-icons.json, built by
 * scripts/build-remix-icons.mjs from the `remixicon` package) and
 * /ycode/api/icons answers from it. The response keeps the shape the picker
 * already reads.
 */

import data from '@/lib/platform/data/remix-icons.json';

export interface RemixIcon {
  source: 'remix';
  name: string;
  category: string;
  style: 'fill' | 'line';
  svg: string;
}

export interface RemixIconQuery {
  search?: string;
  category?: string;
  style?: 'fill' | 'line';
  limit?: number;
  offset?: number;
}

export interface RemixIconPage {
  icons: RemixIcon[];
  total: number;
  categories: { name: string; count: number }[];
  totalIcons: number;
  limit: number;
  offset: number;
}

export const DEFAULT_LIMIT = 100;
export const MAX_LIMIT = 500;

const SVG_OPEN = '<svg viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">';

const ICONS: RemixIcon[] = (data as [string, string, string][]).map(([name, category, body]) => ({
  source: 'remix',
  name,
  category,
  style: name.endsWith('-fill') ? 'fill' : 'line',
  svg: `${SVG_OPEN}${body}</svg>`,
}));

const CATEGORIES = Array.from(
  ICONS.reduce((counts, icon) => counts.set(icon.category, (counts.get(icon.category) ?? 0) + 1), new Map<string, number>()),
  ([name, count]) => ({ name, count }),
);

/** Icons whose name contains every word of the search, optionally within one category and style. */
export function queryRemixIcons(query: RemixIconQuery = {}): RemixIconPage {
  const words = (query.search ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  const matches = ICONS.filter((icon) =>
    (!query.category || icon.category === query.category)
    && (!query.style || icon.style === query.style)
    && words.every((word) => icon.name.includes(word)));

  const limit = Math.min(Math.max(Math.trunc(query.limit ?? DEFAULT_LIMIT), 1), MAX_LIMIT);
  const offset = Math.max(Math.trunc(query.offset ?? 0), 0);

  return {
    icons: matches.slice(offset, offset + limit),
    total: matches.length,
    categories: CATEGORIES,
    totalIcons: ICONS.length,
    limit,
    offset,
  };
}
