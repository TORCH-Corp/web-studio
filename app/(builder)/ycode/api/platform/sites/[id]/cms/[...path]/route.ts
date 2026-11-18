import { NextRequest } from 'next/server';
import { noCache } from '@/lib/api-response';
import { matchCmsRoute, type CmsMethod, type CmsRouteKey } from '@/lib/platform/cms-routes';
import { requirementName } from '@/lib/platform/permissions';
import { hasFlag } from '@/lib/platform/session';
import { getSessionFromCookies, getSiteForOrganization, runWithSite } from '@/lib/platform/site';
import * as collections from '../../../../../collections/route';
import * as collection from '../../../../../collections/[id]/route';
import * as collectionPublish from '../../../../../collections/[id]/publish/route';
import * as fields from '../../../../../collections/[id]/fields/route';
import * as fieldsReorder from '../../../../../collections/[id]/fields/reorder/route';
import * as field from '../../../../../collections/[id]/fields/[field_id]/route';
import * as items from '../../../../../collections/[id]/items/route';
import * as itemsReorder from '../../../../../collections/[id]/items/reorder/route';
import * as item from '../../../../../collections/[id]/items/[item_id]/route';
import * as itemDuplicate from '../../../../../collections/[id]/items/[item_id]/duplicate/route';
import * as itemStatus from '../../../../../collections/[id]/items/[item_id]/status/route';
import * as locales from '../../../../../locales/route';
import * as pages from '../../../../../pages/route';
import * as translations from '../../../../../translations/route';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * /ycode/api/platform/sites/{id}/cms/{path} (owner, 17 Nov 2026): the builder's own collections API, for one site
 * named in the path. The Tauri app's Collections page edits a site's collections, fields and items here: the
 * builder's CMS screen is where they were edited, and the app has no site cookie (taking one opens the site and
 * takes its editor lock). Each request is answered by the builder's own route handler, run for that site
 * (`runWithSite`), so the app and the builder cannot come to differ in what a collection is.
 *
 * `path` is one of the routes below, as it is under /ycode/api, with the same methods, bodies and answers:
 *
 *   collections                                    GET, POST
 *   collections/{id}                               GET, PUT, DELETE
 *   collections/{id}/publish                       POST
 *   collections/{id}/fields                        GET, POST
 *   collections/{id}/fields/reorder                PUT
 *   collections/{id}/fields/{field_id}             GET, PUT, DELETE
 *   collections/{id}/items                         GET, POST
 *   collections/{id}/items/reorder                 POST
 *   collections/{id}/items/{item_id}               GET, PUT, DELETE
 *   collections/{id}/items/{item_id}/duplicate     POST
 *   collections/{id}/items/{item_id}/status        PUT
 *   locales                                        GET
 *   pages                                          GET
 *   translations                                   GET, POST
 *
 * Anything else is 404. The proxy asks `webstudio.manage_content` r of every request here; this handler then asks
 * the flag the builder's route asks for the same method (lib/platform/cms-routes.ts), so a create needs c, a change u, a delete d.
 * No editor lock is asked or taken (owner's decision: the app edits alongside an open builder, which shows the
 * change when it reads the collection again).
 *
 * 401 no session · 403 the flag is missing · 404 no such site, or a path that is none of the above.
 */

type Handler = (request: NextRequest, context: { params: Promise<Record<string, string>> }) => Promise<Response> | Response;

/** A builder route's handler names its own parameters ({ id }, { id, item_id }); here they are found by the pattern, so the handler is taken as one that reads them by name. */
const h = (handler: unknown) => handler as Handler;

/** The builder's handler for each route of lib/platform/cms-routes.ts and each method it lists. */
const HANDLERS: Record<CmsRouteKey, Partial<Record<CmsMethod, Handler>>> = {
  collections: { GET: h(collections.GET), POST: h(collections.POST) },
  collection: { GET: h(collection.GET), PUT: h(collection.PUT), DELETE: h(collection.DELETE) },
  collectionPublish: { POST: h(collectionPublish.POST) },
  fields: { GET: h(fields.GET), POST: h(fields.POST) },
  fieldsReorder: { PUT: h(fieldsReorder.PUT) },
  field: { GET: h(field.GET), PUT: h(field.PUT), DELETE: h(field.DELETE) },
  items: { GET: h(items.GET), POST: h(items.POST) },
  itemsReorder: { POST: h(itemsReorder.POST) },
  item: { GET: h(item.GET), PUT: h(item.PUT), DELETE: h(item.DELETE) },
  itemDuplicate: { POST: h(itemDuplicate.POST) },
  itemStatus: { PUT: h(itemStatus.PUT) },
  locales: { GET: h(locales.GET) },
  pages: { GET: h(pages.GET) },
  translations: { GET: h(translations.GET), POST: h(translations.POST) },
};

async function answer(request: NextRequest, context: { params: Promise<{ id: string; path: string[] }> }): Promise<Response> {
  const session = await getSessionFromCookies();
  if (!session) return noCache({ error: 'Not authenticated' }, 401);

  const { id, path } = await context.params;
  const site = await getSiteForOrganization(id, session.org);
  if (!site) return noCache({ error: 'Site not found' }, 404);

  const route = matchCmsRoute(path, request.method, request.nextUrl.searchParams);
  const handler = route ? HANDLERS[route.key][request.method as CmsMethod] : undefined;
  if (!route || !handler) return noCache({ error: 'Not found' }, 404);
  if (!hasFlag(session, route.requires.leaf, route.requires.flag)) return noCache({ error: 'Forbidden', requires: requirementName(route.requires) }, 403);

  return runWithSite(site.id, async () => handler(request, { params: Promise.resolve(route.params) }));
}

export const GET = answer;
export const POST = answer;
export const PUT = answer;
export const DELETE = answer;
