import { NextRequest, NextResponse } from 'next/server';
import { queryRemixIcons } from '@/lib/platform/remix-icons';

// GET /ycode/api/icons - the Remix icon set, from the repository (no external API)
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const style = params.get('style');
  const limit = params.get('limit');
  const offset = params.get('offset');

  return NextResponse.json(queryRemixIcons({
    search: params.get('search') ?? undefined,
    category: params.get('category') ?? undefined,
    style: style === 'fill' || style === 'line' ? style : undefined,
    limit: limit === null ? undefined : Number(limit) || undefined,
    offset: offset === null ? undefined : Number(offset) || undefined,
  }), { headers: { 'Cache-Control': 'private, max-age=3600' } });
}
