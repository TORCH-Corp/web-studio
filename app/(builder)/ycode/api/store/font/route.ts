import { NextResponse } from 'next/server';
import { getMirroredCss, MirrorRequestError } from '@/lib/platform/font-mirror';
import { STORE_FONT_QUERY, toStoreFontCss } from '@/lib/platform/store-elements/fonts';

/**
 * GET /ycode/api/store/font (part 2, session W4): the stylesheet of IBM Plex
 * Sans Arabic for the store elements, from the platform's font mirror, for a
 * visitor of a published site. Anonymous, and for this one family only: the
 * mirror's own routes stay for the signed-in builder. The font files in it are
 * served by ./files.
 */
export async function GET() {
  try {
    const css = toStoreFontCss(await getMirroredCss(STORE_FONT_QUERY));
    return new NextResponse(css, {
      headers: { 'Content-Type': 'text/css; charset=utf-8', 'Cache-Control': 'public, max-age=86400' },
    });
  } catch (error) {
    if (error instanceof MirrorRequestError) return new NextResponse(error.message, { status: 404 });
    console.error('[GET /ycode/api/store/font] Error:', error);
    return new NextResponse('Font mirror unavailable', { status: 502 });
  }
}
