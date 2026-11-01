/** Pieces shared by the disk and Document Center storage implementations. */

import path from 'path';

export interface StorageError { message: string; statusCode?: string; error?: string }
export interface FileMeta { contentType: string; cacheControl: string; size: number; updatedAt: string }

export function safeKey(key: string): string {
  const normalised = path.posix.normalize('/' + key.replace(/\\/g, '/')).slice(1);
  if (normalised.startsWith('..')) throw new Error('Invalid storage path');
  return normalised;
}

export async function toBuffer(body: unknown): Promise<Buffer> {
  if (Buffer.isBuffer(body)) return body;
  if (body instanceof Uint8Array) return Buffer.from(body);
  if (body instanceof ArrayBuffer) return Buffer.from(body);
  if (typeof body === 'string') return Buffer.from(body);
  if (body && typeof (body as Blob).arrayBuffer === 'function') return Buffer.from(await (body as Blob).arrayBuffer());
  if (body && typeof (body as ReadableStream).getReader === 'function') {
    const chunks: Uint8Array[] = [];
    const reader = (body as ReadableStream<Uint8Array>).getReader();
    for (;;) { const { done, value } = await reader.read(); if (done) break; if (value) chunks.push(value); }
    return Buffer.concat(chunks);
  }
  throw new Error('Unsupported upload body');
}
