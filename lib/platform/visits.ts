/**
 * Storing a view (part 3, session W7; PRD V1.0 "Visit counting").
 *
 * One statement per view in `platform_visits`
 * (database/migrations/20261111000001_torch_visits.ts). The row holds what
 * lib/platform/visit-rules.ts made of the request and nothing of the request
 * itself.
 */

import { getKnexClient } from '@/lib/knex-client';
import type { VisitDevice, VisitOrigin } from '@/lib/platform/visit-rules';

const TABLE = 'platform_visits';

export interface View {
  siteId: string;
  pageId: string;
  path: string;
  at: Date;
  visitorKey: string;
  origin: VisitOrigin;
  device: VisitDevice;
}

/**
 * Store one view. False when the page is not a published page of the site (an
 * error page is not one): nothing is stored then.
 *
 * A view reached from the site's own page ('internal') takes the source of the
 * visitor's first row of the day, so someone who came from a search and reads
 * three pages is three views from search; with no earlier row (the first page
 * was not counted, or the day changed between two pages) it is 'direct'.
 */
export async function recordView(view: View): Promise<boolean> {
  const knex = await getKnexClient();
  const source =
    view.origin === 'internal'
      ? knex.raw(
        `COALESCE((SELECT earlier.source FROM ${TABLE} earlier WHERE earlier.site_id = ? AND earlier.visitor_key = ? ORDER BY earlier.created_at, earlier.id LIMIT 1), 'direct')`,
        [view.siteId, view.visitorKey],
      )
      : knex.raw('?::text', [view.origin]);
  const result = await knex.raw(
    `INSERT INTO ${TABLE} (site_id, page_id, path, created_at, visitor_key, source, device, kind)
     SELECT ?::uuid, ?::uuid, ?::text, ?::timestamptz, ?::text, ?, ?::text, 'view'
     WHERE EXISTS (
       SELECT 1 FROM pages
       WHERE pages.id = ?::uuid AND pages.tenant_id = ?::uuid AND pages.is_published = true
         AND pages.deleted_at IS NULL AND pages.error_page IS NULL
     )`,
    [view.siteId, view.pageId, view.path, view.at, view.visitorKey, source, view.device, view.pageId, view.siteId],
  );
  return (result as { rowCount: number }).rowCount > 0;
}
