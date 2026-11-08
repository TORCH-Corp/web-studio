import { NextRequest, NextResponse } from 'next/server';
import { getMirroredFontFile, MirrorRequestError } from '@/lib/platform/font-mirror';
import { storeFontFilePath } from '@/lib/platform/store-elements/fonts';

const CONTENT_TYPES: Record<string, string> = { woff2: 'font/woff2', woff: 'font/woff', ttf: 'font/ttf' };

/**
 * GET /ycode/api/store/font/files/ibmplexsansarabic/... (part 2, session W4):
 * a font file of the store elements' family from the platform's font mirror.
 * Anonymous; any other family is a 404 here (the mirror's own file route is for
 * the signed-in builder).
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const filePath = storeFontFilePath((await params).path);
  if (!filePath) return new NextResponse('Not found', { status: 404 });

  try {
    const data = await getMirroredFontFile(filePath);
    return new NextResponse(new Uint8Array(data), {
      headers: {
        'Content-Type': CONTENT_TYPES[filePath.split('.').pop() ?? ''] ?? 'application/octet-stream',
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  } catch (error) {
    if (error instanceof MirrorRequestError) return new NextResponse(error.message, { status: 404 });
    console.error('[GET /ycode/api/store/font/files] Error:', error);
    return new NextResponse('Font mirror unavailable', { status: 502 });
  }
}
