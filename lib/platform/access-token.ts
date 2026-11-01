/**
 * The Business OS access token (part 1, session 2).
 *
 * auth-service signs its access tokens with RS256 and publishes no key: its
 * live spec (/documentation/json, 1 Nov 2026) has no key or JWKS route, and
 * the usual paths (/.well-known/jwks.json and friends) answer 404. So Web
 * Studio reads the public key from BOS_JWT_PUBLIC_KEY: the same PEM every
 * other service reads from JWT_PUBLIC_KEY_PATH, pasted into the environment
 * (literal newlines or `\n`).
 *
 * The claims are auth-service's: `sub`, `email`, `entityId` (the organization
 * the user is working in), `entityRole`, `isSuperadmin`, `exp`. There is no
 * name claim (the callback asks GET /users/me for it) and no issuer or
 * audience claim, so only the signature and the times are checked.
 *
 * Web Crypto, so the same code runs in the proxy and in route handlers.
 */

import { b64url, fromB64url } from './session';

/** Environment variables by name, as process.env or a test's object. */
export type Env = Record<string, string | undefined>;

export interface AccessTokenClaims {
  sub: string;
  email?: string;
  status?: string;
  isSuperadmin?: boolean;
  sessionId?: string;
  entityId?: string;
  holdingId?: string;
  entityRole?: string;
  permissionProfileId?: string;
  iat?: number;
  nbf?: number;
  exp: number;
}

/** BOS_JWT_PUBLIC_KEY is missing or is not a PEM public key: a deployment error, not a bad token. */
export class PublicKeyNotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PublicKeyNotConfiguredError';
  }
}

export function publicKeyPem(env: Env = process.env): string {
  const raw = env.BOS_JWT_PUBLIC_KEY;
  if (!raw || !raw.trim()) {
    throw new PublicKeyNotConfiguredError('BOS_JWT_PUBLIC_KEY is not set: Business OS access tokens cannot be verified');
  }
  return raw.replace(/\\n/g, '\n').trim();
}

function pemToDer(pem: string): ArrayBuffer {
  const body = pem.replace(/-----(BEGIN|END) [A-Z ]+-----/g, '').replace(/\s+/g, '');
  const binary = fromB64url(body.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

const keys = new Map<string, Promise<CryptoKey>>();

function importPublicKey(pem: string): Promise<CryptoKey> {
  let key = keys.get(pem);
  if (!key) {
    key = crypto.subtle
      .importKey('spki', pemToDer(pem), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify'])
      .catch((error: unknown) => {
        keys.delete(pem);
        throw new PublicKeyNotConfiguredError(`BOS_JWT_PUBLIC_KEY is not a PEM public key: ${error instanceof Error ? error.message : String(error)}`);
      });
    keys.set(pem, key);
  }
  return key;
}

function decodeSegment(segment: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(fromB64url(segment)) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** The claims of an RS256 token whose signature and times check out; null for anything else. */
export async function verifyAccessToken(
  token: string | null | undefined,
  nowMs: number = Date.now(),
  env: Env = process.env,
): Promise<AccessTokenClaims | null> {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const header = decodeSegment(parts[0]);
  const claims = decodeSegment(parts[1]);
  if (!header || !claims || header.alg !== 'RS256') return null;

  const key = await importPublicKey(publicKeyPem(env));
  const signature = Uint8Array.from(fromB64url(parts[2]), (c) => c.charCodeAt(0));
  const signed = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, signature, signed);
  if (!ok) return null;

  if (typeof claims.sub !== 'string' || !claims.sub) return null;
  if (typeof claims.exp !== 'number') return null;
  const now = Math.floor(nowMs / 1000);
  if (claims.exp <= now) return null;
  if (typeof claims.nbf === 'number' && claims.nbf > now) return null;
  return claims as unknown as AccessTokenClaims;
}

/** The unverified claims, for a client that only needs to know when its token runs out. */
export function unverifiedClaims(token: string): Partial<AccessTokenClaims> | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  return decodeSegment(parts[1]) as Partial<AccessTokenClaims> | null;
}

// Re-exported so a test that builds tokens by hand uses the same encoding.
export { b64url };
