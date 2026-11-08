/**
 * Which permission every builder route needs (part 1, session 2).
 *
 * One map, one file: every route file under app/(builder)/ycode/api names its
 * leaf, and the flag when the method does not say it (POST c, GET r, PUT and
 * PATCH u, DELETE d, the same derivation the platform's services use). The
 * proxy asks `accessFor` for every request under /ycode/api and refuses with
 * 401 when there is no session and 403 when the session lacks the flag; a
 * path this map does not know is not found, and the unit test
 * (permissions.test.ts) fails on a route file without a rule. PRD V1.0
 * "Roles and permissions".
 *
 *   manage_sites     creating and deleting sites (c, d), site settings, the
 *                    domain and the store settings (u), the list, opening a
 *                    site and reading its settings (r)
 *   manage_content   pages, layers, styles, components, assets, fonts, locales,
 *                    translations, versions (c r u d), publish and revert (u),
 *                    static export and project export (export), the AI agent
 *                    and the MCP clients that edit through it (use_ai)
 *   manage_forms     the contact form and its submissions, collections,
 *                    webhooks, API keys and the integrations: part 3, hidden by
 *                    session 3
 *   manage_orders    the storefront (part 2): its buyer-facing reads are
 *                    anonymous on GET (session W2), the checkout on POST and
 *                    its confirmation read on GET (W3); the Orders API comes in W8
 *
 * Public routes have their own credential (the setup wizard, the public API's
 * API keys, the revalidation secret, the OAuth flows) or are anonymous by
 * design (a visitor's form submission, a published page's data). Session-only
 * routes need a Web Studio session and no leaf: they describe the user or
 * answer "managed in Business OS".
 */

import type { Flag, WebStudioLeaf } from './session';
import { WEB_STUDIO_LEAF } from './web-studio-scope';

export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';

export interface LeafRule {
  kind: 'leaf';
  leaf: WebStudioLeaf;
  /** The flag per method where the method's default is wrong. */
  flags?: Partial<Record<Method, Flag>>;
  /** Requests that are anonymous by design (a visitor on a published page): checked before the session. */
  anonymous?: (method: Method, searchParams: URLSearchParams) => boolean;
}

export interface PublicRule {
  kind: 'public';
  reason: string;
}

export interface SessionRule {
  kind: 'session';
  reason: string;
}

export type AccessRule = LeafRule | PublicRule | SessionRule;

export type AccessDecision =
  | { kind: 'public' }
  | { kind: 'session' }
  | { kind: 'leaf'; leaf: WebStudioLeaf; flag: Flag }
  | { kind: 'unmapped' };

export const API_PREFIX = '/ycode/api';

export function flagForMethod(method: string): Flag {
  switch (method.toUpperCase()) {
    case 'POST':
      return 'c';
    case 'PUT':
    case 'PATCH':
      return 'u';
    case 'DELETE':
      return 'd';
    default:
      return 'r';
  }
}

type Anonymous = LeafRule['anonymous'];
const leaf = (key: WebStudioLeaf) => (flags?: LeafRule['flags'], anonymous?: Anonymous): LeafRule => ({ kind: 'leaf', leaf: key, flags, anonymous });
const sites = leaf(WEB_STUDIO_LEAF.manageSites);
const content = leaf(WEB_STUDIO_LEAF.manageContent);
const forms = leaf(WEB_STUDIO_LEAF.manageForms);
const orders = leaf(WEB_STUDIO_LEAF.manageOrders);
const isPublic = (reason: string): PublicRule => ({ kind: 'public', reason });
const sessionOnly = (reason: string): SessionRule => ({ kind: 'session', reason });

const onPost: Anonymous = (method) => method === 'POST';
const onGet: Anonymous = (method) => method === 'GET' || method === 'HEAD';
const whenPublished: Anonymous = (method, searchParams) => method === 'GET' && searchParams.get('published') === 'true';

/** Keyed by the route's path under /ycode/api, as Next names it (`[id]` for a dynamic segment, `[...path]` for the rest of the path). */
export const API_ROUTE_ACCESS: Record<string, AccessRule> = {
  // Sign-in and the session: the entrance and what the builder asks about itself.
  'auth/callback': isPublic('the entrance: the Business OS access token is the credential'),
  'auth/dev-login': isPublic('refuses unless ALLOW_DEV_LOGIN=true'),
  'auth/session': isPublic('answers "no session" without one'),
  'auth/logout': isPublic('ends whatever session there is'),

  // Operations with their own credential.
  'health': isPublic('deployment health: the database answers and the migrations have run'),
  'setup/status': isPublic('health check: is the database reachable'),
  'setup/migrate': isPublic('runs the migrations when the database is behind; nothing a user owns'),
  'revalidate': isPublic('own secret token'),
  'oauth/register': isPublic('RFC 7591 dynamic client registration, anonymous by design'),
  'oauth/token': isPublic('token exchange, authenticated by PKCE or the refresh token'),
  'oauth/authorize': sessionOnly('the consent page posts the signed-in user\'s decision'),
  'v1/collections': isPublic('public API, own API-key auth'),
  'v1/collections/[collection_id]': isPublic('public API, own API-key auth'),
  'v1/collections/[collection_id]/items': isPublic('public API, own API-key auth'),
  'v1/collections/[collection_id]/items/[item_id]': isPublic('public API, own API-key auth'),
  'v1/forms': isPublic('public API, own API-key auth'),
  'v1/forms/[form_id]': isPublic('public API, own API-key auth'),
  'v1/forms/[form_id]/submissions': isPublic('public API, own API-key auth'),
  'v1/forms/[form_id]/submissions/[submission_id]': isPublic('public API, own API-key auth'),

  // Sites.
  'platform/sites': sites(), // GET the list (r), POST create (c)
  'platform/sites/[id]': sites(), // GET one site with its editor lock (r, session 6); DELETE (d)
  'platform/sites/[id]/open': sites(), // GET (r)
  'platform/sites/[id]/settings': sites(), // GET (r), PATCH (u): name, languages, domain, SEO defaults, slug (session 7)
  'platform/sites/[id]/store': sites(), // GET (r), PATCH (u): selling, currency, branch, categories, delivery fee (part 2, W1)
  'platform/sites/[id]/assets': sites(), // GET (r): the site's images a share image can be, for Site settings (session 10)
  'platform/sites/[id]/assets/[assetId]': sites(), // GET (r): one image of the site, served as /a/ serves it (session 10)
  'platform/store-elements/categories': content(), // GET (r): the categories a product grid can list, for the open site (part 2, W4)
  'platform/store-elements/products': content(), // GET (r): the products a product card can pick, for the open site (part 2, W4)
  'platform/templates': sites(), // GET (r): TORCH's templates, the same list for every organization (session 4)
  // The builder keeps the open site's editor lock (session 6): POST takes it or refreshes it, DELETE lets go. A
  // builder that may only read still holds the lock for the minutes it is open, so these are reads, never writes.
  'platform/site-lock': content({ POST: 'r', DELETE: 'r' }),
  'devtools/reset-db': sites({ POST: 'd' }),
  'devtools/run-migrations': sites({ POST: 'x' }),

  // Content: the builder's own data.
  'editor/init': content(),
  'pages': content(),
  'pages/[id]': content(),
  'pages/[id]/collection-item': content(),
  'pages/[id]/duplicate': content(),
  'pages/[id]/status': content({ POST: 'u' }),
  'pages/drafts': content(),
  'pages/slug/[slug]': content(),
  'pages/unpublished': content(),
  'folders': content(),
  'folders/[id]': content(),
  'folders/[id]/duplicate': content(),
  'layers': content(),
  'layer-styles': content(),
  'layer-styles/[id]': content(),
  'layer-styles/bulk': content(),
  'layer-styles/unpublished': content(),
  'color-variables': content(),
  'color-variables/[id]': content(),
  'color-variables/reorder': content(),
  'components': content(),
  'components/[id]': content(),
  'components/[id]/thumbnail': content({ POST: 'u', DELETE: 'u' }),
  'components/unpublished': content(),
  'layouts': content(),
  'layouts/[layoutKey]': content(),
  'globals': content(),
  'globals/[id]': content(),
  'fonts': content(),
  'fonts/[id]': content(),
  'fonts/google': content(),
  'fonts/mirror/css2': content(), // the builder's Google Fonts, from the platform mirror (session 3)
  'fonts/mirror/s/[...path]': content(),
  'icons': content(), // the Remix icon set, from the repository (session 3)
  'assets': content(),
  'assets/[id]': content(),
  'assets/[id]/usage': content(),
  'assets/bulk': content({ POST: 'u' }),
  'assets/upload': content(),
  'asset-folders': content(),
  'asset-folders/[id]': content(),
  'files/upload': content(),
  'files/presign': content(),
  'files/register': content(),
  'files/delete': content(),
  'locales': content(),
  'locales/[id]': content(),
  'locales/[id]/default': content({ POST: 'u' }),
  'translations': content(),
  'translations/[id]': content(),
  'translations/bulk': content({ POST: 'u' }),
  'versions': content(),
  'versions/[id]': content(),
  'publish': content({ POST: 'u' }),
  'publish/preview': content(),
  'revert': content({ POST: 'u' }),
  'css/generate': content({ POST: 'u' }),
  'css/generate-pages': content({ POST: 'u' }),
  'cache/clear-all': content({ POST: 'u' }),
  'cache/clear-tag': content({ POST: 'u' }),
  'cache/warm': content({ POST: 'u' }),
  'error-page': content(undefined, whenPublished), // a visitor's error page is rendered anonymously; drafts stay behind the session
  'settings/[key]': content(),
  'settings/batch': content(),
  'settings/email/test': content({ POST: 'u' }),
  'settings/agent': content(),
  'settings/agent/test': content({ POST: 'u' }),
  'project/export': content({ POST: 'export' }),
  'project/import': content({ POST: 'u' }),
  'maps/geocode': content(),
  'apps': content(),
  'apps/[appId]/settings': content(),
  'apps/static-export/export': content({ POST: 'export' }),
  'apps/static-export/settings': content(),
  'apps/static-export/status': content(),
  'ai/chat': content({ POST: 'use_ai' }),
  'ai/chats': content({ GET: 'use_ai' }),
  'ai/chats/[id]': content({ GET: 'use_ai', PUT: 'use_ai', DELETE: 'use_ai' }),
  'mcp-tokens': content({ GET: 'use_ai', POST: 'use_ai' }),
  'mcp-tokens/[id]': content({ GET: 'use_ai', DELETE: 'use_ai' }),

  // The storefront (part 2, session W2): a visitor of a published site reads its catalogue anonymously. The routes
  // answer only on a site's own host, and only while its store sells (lib/platform/store-api.ts); the builder host 404s.
  'store/products': orders(undefined, onGet),
  'store/products/[id]': orders(undefined, onGet),
  'store/categories': orders(undefined, onGet),
  'store/settings': orders(undefined, onGet),
  // A visitor checks out (session W3): screened like the form route (same origin, honeypot, rate limit, size caps).
  'store/checkout': orders(undefined, onPost),
  'store/orders/[checkout_id]': orders(undefined, onGet), // the confirmation page's read of its order
  // The store elements (part 2, session W4): their font is one family from the platform's mirror, read by any visitor
  // (the mirror's own routes stay for the builder).
  'store/font': isPublic('the stylesheet of one font family (IBM Plex Sans Arabic) from the platform mirror, for the store pages'),
  'store/font/files/[...path]': isPublic('the font files of that one family from the platform mirror; any other family is a 404'),

  // Forms and collections (part 3; hidden by session 3).
  'form-submissions': forms(undefined, onPost), // a visitor submits a form anonymously
  'form-submissions/[id]': forms(),
  'collections': forms(),
  'collections/[id]': forms(),
  'collections/[id]/usage': forms(),
  'collections/[id]/publish': forms({ POST: 'u' }),
  'collections/[id]/import': forms(),
  'collections/[id]/fields': forms(),
  'collections/[id]/fields/[field_id]': forms(),
  'collections/[id]/fields/[field_id]/usage': forms(),
  'collections/[id]/fields/reorder': forms(),
  'collections/[id]/items': forms(),
  'collections/[id]/items/[item_id]': forms(),
  'collections/[id]/items/[item_id]/duplicate': forms(),
  'collections/[id]/items/[item_id]/status': forms(),
  'collections/[id]/items/[item_id]/values': forms(),
  'collections/[id]/items/filter': forms(undefined, onPost), // a published page filters its collection
  'collections/[id]/items/load-more': forms(undefined, onPost), // a published page loads more items
  'collections/[id]/items/published': forms(),
  'collections/[id]/items/unpublished': forms(),
  'collections/[id]/items/reorder': forms({ POST: 'u' }),
  'collections/fields': forms(),
  'collections/import/[importId]/status': forms(),
  'collections/import/process': forms(),
  'collections/items/batch': forms({ POST: 'r' }), // reads the first items of several collections
  'collections/items/delete': forms({ POST: 'd' }),
  'collections/items/slugs': forms({ POST: 'r' }), // resolves item ids to slugs
  'collections/reorder': forms(),
  'collections/sample': forms(),
  'webhooks': forms(),
  'webhooks/[id]': forms({ POST: 'u' }),
  'webhooks/[id]/deliveries': forms(),
  'api-keys': forms(),
  'api-keys/[id]': forms(),
  'apps/airtable/bases': forms(),
  'apps/airtable/bases/[baseId]/tables': forms(),
  'apps/airtable/connections': forms(),
  'apps/airtable/connections/[connectionId]': forms(),
  'apps/airtable/sync': forms({ POST: 'u' }),
  'apps/airtable/test': forms({ POST: 'u' }),
  'apps/airtable/webhook/setup': forms({ POST: 'u' }),
  'apps/airtable/webhook/refresh': forms({ POST: 'u' }),
  'apps/airtable/webhook/disable': forms({ POST: 'u' }),
  'apps/webflow/imports': forms(),
  'apps/webflow/imports/[importId]': forms(),
  'apps/webflow/migrate': forms(),
  'apps/webflow/sites': forms(),
  'apps/webflow/sites/[siteId]/collections': forms(),
  'apps/webflow/stylesheet': forms(),
  'apps/webflow/sync': forms({ POST: 'u' }),
  'apps/webflow/test': forms({ POST: 'u' }),
  'apps/mailerlite/fields': forms(),
  'apps/mailerlite/groups': forms(),
  'apps/mailerlite/test': forms({ POST: 'u' }),
};

/** The gated paths outside /ycode/api: the builder's preview and the template service bridge. */
export const GATED_PREFIXES: ReadonlyArray<{ prefix: string; rule: AccessRule }> = [
  { prefix: '/ycode/preview', rule: content() },
  { prefix: '/api/templates', rule: content({ POST: 'export' }) }, // POST export-and-upload sends the site to the template service
];

interface CompiledRoute {
  pattern: string;
  segments: string[];
  literals: number;
  /** The last segment is `[...name]`: it takes the rest of the path. */
  catchAll: boolean;
  rule: AccessRule;
}

const COMPILED: CompiledRoute[] = Object.entries(API_ROUTE_ACCESS).map(([pattern, rule]) => {
  const segments = pattern.split('/');
  return {
    pattern,
    segments,
    literals: segments.filter((segment) => !segment.startsWith('[')).length,
    catchAll: segments[segments.length - 1].startsWith('[...'),
    rule,
  };
});

/** The map entry for a request path under /ycode/api; the most literal pattern wins. Null when none fits. */
export function matchApiRoute(pathname: string): string | null {
  if (pathname !== API_PREFIX && !pathname.startsWith(`${API_PREFIX}/`)) return null;
  const segments = pathname.slice(API_PREFIX.length + 1).replace(/\/+$/, '').split('/');
  let best: CompiledRoute | null = null;
  for (const route of COMPILED) {
    if (route.catchAll ? segments.length < route.segments.length : segments.length !== route.segments.length) continue;
    const fits = route.segments.every((segment, i) =>
      segment.startsWith('[...') ? segments.slice(i).every((s) => s !== '') : segment.startsWith('[') ? segments[i] !== '' : segment === segments[i]);
    if (fits && (!best || route.literals > best.literals)) best = route;
  }
  return best?.pattern ?? null;
}

function decide(rule: AccessRule, method: Method, searchParams: URLSearchParams): AccessDecision {
  if (rule.kind !== 'leaf') return { kind: rule.kind };
  if (rule.anonymous?.(method, searchParams)) return { kind: 'public' };
  return { kind: 'leaf', leaf: rule.leaf, flag: rule.flags?.[method] ?? flagForMethod(method) };
}

/**
 * What a request needs. Null when the path is not one this map gates (the
 * proxy decides those as before); `unmapped` for a path under /ycode/api that
 * no route names, which the proxy answers 404.
 */
export function accessFor(pathname: string, method: string, searchParams: URLSearchParams): AccessDecision | null {
  const m = method.toUpperCase() as Method;
  const pattern = matchApiRoute(pathname);
  if (pattern) return decide(API_ROUTE_ACCESS[pattern], m, searchParams);
  if (pathname === API_PREFIX || pathname.startsWith(`${API_PREFIX}/`)) return { kind: 'unmapped' };
  const gated = GATED_PREFIXES.find(({ prefix }) => pathname === prefix || pathname.startsWith(`${prefix}/`));
  return gated ? decide(gated.rule, m, searchParams) : null;
}

const SAFE_METHODS = new Set<string>(['GET', 'HEAD', 'OPTIONS']);
/** The leaves whose routes change what the builder edits: the sites API (creating and deleting sites) is not one. */
const EDITING_LEAVES = new Set<WebStudioLeaf>([WEB_STUDIO_LEAF.manageContent, WEB_STUDIO_LEAF.manageForms]);

/**
 * Does this request change the open site? Then the caller must hold the site's
 * editor lock (session 6). A write is a non-safe method on a content or forms
 * route whose flag is not a read: `r` marks the POSTs that only read (the
 * lock's own heartbeat, batch lookups) and `export` a download of what exists.
 */
export function isEditingWrite(decision: AccessDecision, method: string): boolean {
  if (decision.kind !== 'leaf' || !EDITING_LEAVES.has(decision.leaf)) return false;
  if (SAFE_METHODS.has(method.toUpperCase())) return false;
  return decision.flag !== 'r' && decision.flag !== 'export';
}

/** `webstudio.manage_sites.c`: the box an administrator ticks. */
export function requirementName(decision: { leaf: WebStudioLeaf; flag: Flag }): string {
  return `${decision.leaf}.${decision.flag}`;
}

/**
 * Only a user who may change content holds the editor lock (owner decision of
 * 2 Nov 2026, open question 18): a reader opening a site, or their heartbeat,
 * never blocks an editor who comes next.
 */
export function mayHoldSiteLock(perms: Partial<Record<WebStudioLeaf, Flag[]>>): boolean {
  return (perms['webstudio.manage_content'] ?? []).includes('u');
}
