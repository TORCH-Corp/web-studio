import { NextRequest, NextResponse } from 'next/server';
import { getMirroredCss, MirrorRequestError } from '@/lib/platform/font-mirror';

// GET /ycode/api/fonts/mirror/css2?family=... - Google Fonts stylesheet from the platform mirror
export async function GET(request: NextRequest) {
  try {
    const css = await getMirroredCss(request.nextUrl.search.slice(1));
    return new NextResponse(css, {
      headers: { 'Content-Type': 'text/css; charset=utf-8', 'Cache-Control': 'private, max-age=86400' },
    });
  } catch (error) {
    if (error instanceof MirrorRequestError) {
      return new NextResponse(error.message, { status: 404 });
    }
    console.error('[GET /ycode/api/fonts/mirror/css2] Error:', error);
    return new NextResponse('Font mirror unavailable', { status: 502 });
  }
}
