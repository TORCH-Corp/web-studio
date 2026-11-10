/**
 * Dynamic Robots.txt Route
 *
 * Generates robots.txt with configurable content and sitemap reference
 */

import { NextResponse } from 'next/server';
import { getTenantIdFromHeaders } from '@/lib/supabase-server';
import { headers } from 'next/headers';
import { getSettingsByKeys } from '@/lib/repositories/settingsRepository';
import { credentials } from '@/lib/credentials';
import { getRequestOrigin, getSiteBaseUrl } from '@/lib/url-utils';
import { tagResponseForPublish } from '@/lib/response-cache-tag';
import type { SitemapSettings } from '@/types';

// Reads the request origin, so it can never be prerendered at build time
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    // A host that belongs to no site has no robots.txt or sitemap (part 1, session 5).
    if (!(await getTenantIdFromHeaders())) return new NextResponse(null, { status: 404 });

    await tagResponseForPublish();

    const requestOrigin = getRequestOrigin(await headers());

    const hasSupabaseCredentials = await credentials.exists();
    if (!hasSupabaseCredentials) {
      const baseUrl = getSiteBaseUrl({ requestOrigin }) || '';
      const fallback = `# Default robots.txt
User-agent: *
Allow: /
Disallow: /studio/

# Sitemap
Sitemap: ${baseUrl}/sitemap.xml`;

      return new NextResponse(fallback, {
        headers: {
          'Content-Type': 'text/plain',
          'Cache-Control': 'public, max-age=86400, s-maxage=86400',
        },
      });
    }

    const allSettings = await getSettingsByKeys(['robots_txt', 'sitemap', 'global_canonical_url']);
    const sitemapSettings = allSettings.sitemap as SitemapSettings | null;
    const sitemapEnabled = sitemapSettings?.mode && sitemapSettings.mode !== 'none';
    const baseUrl = getSiteBaseUrl({ globalCanonicalUrl: allSettings.global_canonical_url, requestOrigin }) || '';

    let content: string;

    const customRobots = allSettings.robots_txt;
    if (customRobots && typeof customRobots === 'string' && customRobots.trim()) {
      content = customRobots.trim();

      if (sitemapEnabled && !content.toLowerCase().includes('sitemap:')) {
        content += `\n\nSitemap: ${baseUrl}/sitemap.xml`;
      }
    } else {
      content = `# Default robots.txt
User-agent: *
Allow: /

# Disallow admin/editor paths
Disallow: /studio/`;

      if (sitemapEnabled) {
        content += `\n\n# Sitemap\nSitemap: ${baseUrl}/sitemap.xml`;
      }
    }

    return new NextResponse(content, {
      headers: {
        'Content-Type': 'text/plain',
        'Cache-Control': 'public, max-age=86400, s-maxage=86400',
      },
    });
  } catch (error) {
    console.error('[robots.txt] Error generating robots.txt:', error);

    // Return default on error
    const fallback = `User-agent: *
Allow: /
Disallow: /studio/`;

    return new NextResponse(fallback, {
      headers: {
        'Content-Type': 'text/plain',
        'Cache-Control': 'public, max-age=3600',
      },
    });
  }
}
