/**
 * The builder's collections routes that the app may reach for one site through
 * `/ycode/api/platform/sites/{id}/cms/{path}` (owner, 17 Nov 2026), and the flag each asks. Pure: the route file
 * holds the handlers; this says which paths and methods exist and what they need, so it is tested without Next.
 */

import { accessFor, API_PREFIX } from '@/lib/platform/permissions';
import type { Flag, WebStudioLeaf } from '@/lib/platform/session';

export type CmsMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

/** A segment that starts with ':' is a parameter of the builder's route. Literal routes are listed before the ones they would shadow. */
export const CMS_ROUTES = [
  { key: 'collections', pattern: ['collections'], methods: ['GET', 'POST'] },
  { key: 'collection', pattern: ['collections', ':id'], methods: ['GET', 'PUT', 'DELETE'] },
  { key: 'collectionPublish', pattern: ['collections', ':id', 'publish'], methods: ['POST'] },
  { key: 'fields', pattern: ['collections', ':id', 'fields'], methods: ['GET', 'POST'] },
  { key: 'fieldsReorder', pattern: ['collections', ':id', 'fields', 'reorder'], methods: ['PUT'] },
  { key: 'field', pattern: ['collections', ':id', 'fields', ':field_id'], methods: ['GET', 'PUT', 'DELETE'] },
  { key: 'items', pattern: ['collections', ':id', 'items'], methods: ['GET', 'POST'] },
  { key: 'itemsReorder', pattern: ['collections', ':id', 'items', 'reorder'], methods: ['POST'] },
  { key: 'item', pattern: ['collections', ':id', 'items', ':item_id'], methods: ['GET', 'PUT', 'DELETE'] },
  { key: 'itemDuplicate', pattern: ['collections', ':id', 'items', ':item_id', 'duplicate'], methods: ['POST'] },
  { key: 'itemStatus', pattern: ['collections', ':id', 'items', ':item_id', 'status'], methods: ['PUT'] },
  { key: 'locales', pattern: ['locales'], methods: ['GET'] },
  { key: 'translations', pattern: ['translations'], methods: ['GET', 'POST'] },
] as const satisfies ReadonlyArray<{ key: string; pattern: readonly string[]; methods: readonly CmsMethod[] }>;

export type CmsRouteKey = (typeof CMS_ROUTES)[number]['key'];

export interface CmsMatch {
  key: CmsRouteKey;
  /** The builder route's own parameters, by name. */
  params: Record<string, string>;
  /** What the builder's route asks for this method: the app is given no more than the builder. */
  requires: { leaf: WebStudioLeaf; flag: Flag };
}

/** The route a path and method are, or null: a path that is none of the routes, a method the route does not have, or a route no leaf guards. */
export function matchCmsRoute(path: string[], method: string, searchParams: URLSearchParams = new URLSearchParams()): CmsMatch | null {
  for (const route of CMS_ROUTES) {
    if (route.pattern.length !== path.length) continue;
    const params: Record<string, string> = {};
    const fits = route.pattern.every((segment, i) => {
      if (!segment.startsWith(':')) return segment === path[i];
      params[segment.slice(1)] = path[i];
      return path[i] !== '';
    });
    if (!fits) continue;
    if (!(route.methods as readonly string[]).includes(method.toUpperCase())) return null;
    const access = accessFor(`${API_PREFIX}/${path.join('/')}`, method, searchParams);
    if (!access || access.kind !== 'leaf') return null;
    return { key: route.key, params, requires: { leaf: access.leaf, flag: access.flag } };
  }
  return null;
}
