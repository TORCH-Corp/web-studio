import { NextRequest, NextResponse } from 'next/server';
import { getMirroredFontFile, MirrorRequestError } from '@/lib/platform/font-mirror';

const CONTENT_TYPES: Record<string, string> = { woff2: 'font/woff2', woff: 'font/woff', ttf: 'font/ttf' };

// GET /ycode/api/fonts/mirror/s/... - a Google Fonts file from the platform mirror
export async function GET(_request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const filePath = `s/${path.join('/')}`;

  try {
    const data = await getMirroredFontFile(filePath);
    return new NextResponse(new Uint8Array(data), {
      headers: {
        'Content-Type': CONTENT_TYPES[filePath.split('.').pop() ?? ''] ?? 'application/octet-stream',
        'Cache-Control': 'private, max-age=31536000, immutable',
      },
    });
  } catch (error) {
    if (error instanceof MirrorRequestError) {
      return new NextResponse(error.message, { status: 404 });
    }
    console.error('[GET /ycode/api/fonts/mirror/s] Error:', error);
    return new NextResponse('Font mirror unavailable', { status: 502 });
  }
}
