import { NextRequest, NextResponse } from 'next/server';
import { getMirroredFontFile, MirrorRequestError } from '@/lib/platform/font-mirror';
import { isPublishedFontFile } from '@/lib/platform/published-fonts';
import { publishedFontFilePath } from '@/lib/platform/published-fonts-url';

const CONTENT_TYPES: Record<string, string> = { woff2: 'font/woff2', woff: 'font/woff', ttf: 'font/ttf' };

/**
 * GET /ycode/api/fonts/published/{family}/{version}/{file} (part 2, session 26):
 * a font file of a published page, from the platform's font mirror. Anonymous:
 * a visitor has no session. Only a file that a published page's font rules name
 * is served (lib/platform/published-fonts.ts); anything else the mirror holds
 * or could fetch is a 404 here, and stays the signed-in builder's.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const filePath = publishedFontFilePath((await params).path);

  try {
    if (!filePath || !(await isPublishedFontFile(filePath))) return new NextResponse('Not found', { status: 404 });
    const data = await getMirroredFontFile(filePath);
    return new NextResponse(new Uint8Array(data), {
      headers: {
        'Content-Type': CONTENT_TYPES[filePath.split('.').pop() ?? ''] ?? 'application/octet-stream',
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  } catch (error) {
    if (error instanceof MirrorRequestError) return new NextResponse(error.message, { status: 404 });
    console.error('[GET /ycode/api/fonts/published] Error:', error);
    return new NextResponse('Font mirror unavailable', { status: 502 });
  }
}
