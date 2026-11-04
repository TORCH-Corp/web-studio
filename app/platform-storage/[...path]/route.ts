import { NextRequest, NextResponse } from 'next/server';
import { readObject, verifyUpload, writeObject } from '@/lib/platform/storage';

/**
 * Platform file storage over HTTP (c0 port).
 *
 *   GET /platform-storage/{site}/{bucket}/{key}                    public read
 *   PUT /platform-storage/upload/{site}/{bucket}/{key}?token&expires
 *                                                                  signed upload
 *
 * Objects are files on disk or Document Center documents, by PLATFORM_STORAGE
 * (lib/platform/storage.ts). Document Center has no public URL, so this route
 * is where its files are served from.
 */
export const runtime = 'nodejs';

export async function GET(_request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  if (path.length < 3) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const [siteId, bucket, ...rest] = path;
  let obj;
  try {
    obj = await readObject(siteId, bucket, rest.map(decodeURIComponent).join('/'));
  } catch (e) {
    console.error('Reading a stored file failed:', e);
    return NextResponse.json({ error: 'storage unavailable' }, { status: 502 });
  }
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
  const [, siteId, bucket, ...rest] = path;
  const key = rest.map(decodeURIComponent).join('/');
  const token = request.nextUrl.searchParams.get('token') || '';
  const expires = Number(request.nextUrl.searchParams.get('expires'));
  if (!verifyUpload(siteId, bucket, key, expires, token)) {
    return NextResponse.json({ error: 'invalid or expired upload token' }, { status: 403 });
  }
  const data = Buffer.from(await request.arrayBuffer());
  await writeObject(siteId, bucket, key, data, request.headers.get('content-type') || 'application/octet-stream');
  return NextResponse.json({ Key: `${bucket}/${key}`, path: key });
}
