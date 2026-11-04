/**
 * A site's images, for the share image of its SEO defaults (part 1, session 10).
 *
 * The builder lists assets for the site its `ws_site` cookie names
 * (`/ycode/api/assets`); the Tauri app has no such cookie, and taking one means
 * opening the site, which takes its editor lock. So the app reads the site's
 * images here, by id, through the platform client scoped to that site, and
 * loads each one from `GET /sites/{id}/assets/{assetId}`.
 */

import { getSupabaseAdmin } from '@/lib/supabase-server';
import { runWithSite, type Site } from '@/lib/platform/site';
import { containsPattern, SHARE_IMAGE_MIME_TYPES, type SiteAssetsQuery } from '@/lib/platform/site-assets-input';

export interface SiteImage {
  id: string;
  filename: string;
  mime_type: string;
  width: number | null;
  height: number | null;
}

export interface SiteImagesPage {
  data: SiteImage[];
  total: number;
  page: number;
  limit: number;
  has_more: boolean;
}

interface AssetRow {
  id: string;
  filename: string;
  mime_type: string;
  width: number | null;
  height: number | null;
}

/** The site's draft images a share image can be, newest first; the caller has checked the site is the session's organization's. */
export async function listSiteImages(site: Site, query: SiteAssetsQuery): Promise<SiteImagesPage> {
  return runWithSite(site.id, async () => {
    const client = await getSupabaseAdmin();
    if (!client) throw new Error('Failed to initialize the database client');

    const offset = (query.page - 1) * query.limit;
    let request = client
      .from('assets')
      .select('id, filename, mime_type, width, height', { count: 'exact' })
      .eq('is_published', false)
      .is('deleted_at', null)
      .in('mime_type', SHARE_IMAGE_MIME_TYPES);
    if (query.search) request = request.ilike('filename', containsPattern(query.search));
    const { data, error, count } = await request
      .order('created_at', { ascending: false })
      .order('id', { ascending: true })
      .range(offset, offset + query.limit - 1);
    if (error) throw new Error(`Failed to list the site's images: ${error.message}`);

    const rows = (data ?? []) as AssetRow[];
    const total = count ?? 0;
    return {
      data: rows.map((row) => ({
        id: row.id,
        filename: row.filename,
        mime_type: row.mime_type,
        width: row.width ?? null,
        height: row.height ?? null,
      })),
      total,
      page: query.page,
      limit: query.limit,
      has_more: offset + rows.length < total,
    };
  });
}
