/**
 * The RSA key pair that stands in for auth-service's in the e2e suite: the app
 * verifies with the public half (BOS_JWT_PUBLIC_KEY), the specs sign with the
 * private half. Kept on disk under the temp directory so the Playwright
 * runner, its workers and the auth stub all read the same pair; made the first
 * time, test-only, never committed.
 */

import { createSign, generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DIR = path.join(os.tmpdir(), 'web-studio-e2e');
const PRIVATE_PATH = path.join(DIR, 'jwt-private.pem');
const PUBLIC_PATH = path.join(DIR, 'jwt-public.pem');

export function ensureTestKeys(): { privateKeyPem: string; publicKeyPem: string } {
  mkdirSync(DIR, { recursive: true });
  if (!existsSync(PRIVATE_PATH) || !existsSync(PUBLIC_PATH)) {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    writeFileSync(PRIVATE_PATH, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
    writeFileSync(PUBLIC_PATH, publicKey.export({ type: 'spki', format: 'pem' }));
  }
  return { privateKeyPem: readFileSync(PRIVATE_PATH, 'utf8'), publicKeyPem: readFileSync(PUBLIC_PATH, 'utf8') };
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

/** An RS256 token with auth-service's claims, signed with the test key (or another key, to be refused). */
export function signTestToken(
  claims: Record<string, unknown>,
  options: { ttlSeconds?: number; privateKeyPem?: string; header?: Record<string, unknown> } = {},
): string {
  const now = Math.floor(Date.now() / 1000);
  const body = { status: 'active', isSuperadmin: false, viewOnly: false, iat: now, exp: now + (options.ttlSeconds ?? 900), ...claims };
  const data = `${b64url(JSON.stringify(options.header ?? { alg: 'RS256', typ: 'JWT' }))}.${b64url(JSON.stringify(body))}`;
  const signature = createSign('RSA-SHA256').update(data).sign(options.privateKeyPem ?? ensureTestKeys().privateKeyPem);
  return `${data}.${b64url(signature)}`;
}
