import { NextRequest, NextResponse } from 'next/server';
import { readObject, verifyUpload, writeObject } from '@/lib/platform/storage';

/**
 * Platform file storage over HTTP (c0 port).
 *
 *   GET /platform-storage/{organization}/{bucket}/{key}            public read
 *   PUT /platform-storage/upload/{organization}/{bucket}/{key}?token&expires
 *                                                                  signed upload
 *
 * Objects are files on disk (lib/platform/storage.ts). Swapping in the
 * platform object store changes that module, not this route.
 */
export const runtime = 'nodejs';

export async function GET(_request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  if (path.length < 3) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const [organizationId, bucket, ...rest] = path;
  const obj = await readObject(organizationId, bucket, rest.map(decodeURIComponent).join('/'));
  if (!obj) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return new NextResponse(new Uint8Array(obj.data), {
    headers: {
      'content-type': obj.meta.contentType,
      'cache-control': `public, ${obj.meta.cacheControl}`,
      'content-length': String(obj.data.length),
      'access-control-allow-origin': '*',
    },
  });
}

export async function PUT(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  if (path[0] !== 'upload' || path.length < 4) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const [, organizationId, bucket, ...rest] = path;
  const key = rest.map(decodeURIComponent).join('/');
  const token = request.nextUrl.searchParams.get('token') || '';
  const expires = Number(request.nextUrl.searchParams.get('expires'));
  if (!verifyUpload(organizationId, bucket, key, expires, token)) {
    return NextResponse.json({ error: 'invalid or expired upload token' }, { status: 403 });
  }
  const data = Buffer.from(await request.arrayBuffer());
  await writeObject(organizationId, bucket, key, data, request.headers.get('content-type') || 'application/octet-stream');
  return NextResponse.json({ Key: `${bucket}/${key}`, path: key });
}
