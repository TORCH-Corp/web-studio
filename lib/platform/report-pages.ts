/**
 * The name of the page behind a visited path (part 3, session W9; PRD V1.0 "Traffic report", "the most viewed
 * pages").
 *
 * The daily totals keep a page's path and not its id (database/migrations/20261111000001_torch_visits.ts), so the
 * report finds the name again from the site's own pages: the path each page has now, built the way the builder
 * builds it (`buildSlugPath`, lib/page-utils.ts: the folders' slugs, then the page's own, the index page being the
 * folder itself). A dynamic page, one made by a collection, is the name of every path its collection makes: its
 * `{slug}` stands for one segment. A published page's path may begin with a language code of the site
 * (`/ar/about`): the page is the one without it.
 *
 * A path no page has now has no name, `null`: the page was deleted since the visit, or its slug changed. The report
 * shows the path then. The name is the page's name in the builder, not a translation of it.
 *
 * Pure: the rows go in, a function comes out, so the unit tests read no database.
 */

import { buildSlugPath } from '@/lib/page-utils';
import type { Page, PageFolder } from '@/types';

/** The columns of a page this reads. */
export interface PageRecord {
  id: string;
  name: string;
  slug: string;
  is_index: boolean;
  is_dynamic: boolean;
  page_folder_id: string | null;
}

/** The columns of a folder this reads. */
export interface FolderRecord {
  id: string;
  slug: string;
  page_folder_id: string | null;
}

const WILDCARD = '{slug}';

/** `/a/b` as `['a', 'b']`; the root as `[]`. */
const segmentsOf = (path: string): string[] => path.split('/').filter(Boolean);

/** The name of the page a path belongs to, or null. */
export type PageNamer = (path: string) => string | null;

/**
 * The namer for a site's pages and folders (the draft rows, none deleted, no error page) and its language codes.
 * Two pages never share a path, but if two did, the first in the list is the one named.
 */
export function pageNamer(pages: readonly PageRecord[], folders: readonly FolderRecord[], localeCodes: readonly string[]): PageNamer {
  const exact = new Map<string, string>();
  const dynamic: Array<{ segments: string[]; name: string }> = [];
  const asFolders = folders as unknown as PageFolder[];

  for (const page of pages) {
    const path = buildSlugPath(page as unknown as Page, asFolders, 'page', WILDCARD);
    if (page.is_dynamic) dynamic.push({ segments: segmentsOf(path), name: page.name });
    else if (!exact.has(path)) exact.set(path, page.name);
  }

  const codes = new Set(localeCodes);

  const find = (path: string): string | null => {
    const found = exact.get(path);
    if (found !== undefined) return found;
    const segments = segmentsOf(path);
    const pattern = dynamic.find((candidate) => candidate.segments.length === segments.length && candidate.segments.every((segment, i) => segment === WILDCARD || segment === segments[i]));
    return pattern?.name ?? null;
  };

  return (path) => {
    const own = find(path);
    if (own !== null) return own;
    // /ar/about is the about page: the language code is not part of the page's own path.
    const [first, ...rest] = segmentsOf(path);
    return first !== undefined && codes.has(first) ? find(`/${rest.join('/')}`) : null;
  };
}
