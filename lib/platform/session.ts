/**
 * Business OS session for Web Studio (c0 port).
 *
 * The builder trusts a signed session issued by Business OS Auth and carried
 * in the `bos_session` cookie: who the user is, which organization they are
 * working in, and their Web Studio permission flags. Nothing here creates
 * users; the only issuer in this prototype is the dev login route, which
 * stands in for `auth-service`.
 *
 * Web Crypto is used so the same code runs in the Next proxy and in route
 * handlers.
 */

export const SESSION_COOKIE = 'bos_session';

/** Web Studio permission leaves, one per area of the app, with the standard flags. */
export type WebStudioLeaf = 'webstudio.manage_sites' | 'webstudio.manage_content' | 'webstudio.manage_forms' | 'webstudio.manage_orders';
export type Flag = 'c' | 'r' | 'u' | 'd' | 'x' | 'export' | 'use_ai';

export interface BosSession {
  sub: string;
  email: string;
  name: string;
  org: string;
  perms: Partial<Record<WebStudioLeaf, Flag[]>>;
  iat: number;
  exp: number;
}

const encoder = new TextEncoder();

function b64url(input: ArrayBuffer | string): string {
  const bytes = typeof input === 'string' ? encoder.encode(input) : new Uint8Array(input);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(s: string): string {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  return atob(padded);
}

async function key(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

function secret(): string {
  const s = process.env.BOS_SESSION_SECRET;
  if (!s) throw new Error('BOS_SESSION_SECRET is not set');
  return s;
}

export async function signSession(payload: Omit<BosSession, 'iat' | 'exp'>, ttlSeconds = 8 * 3600): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const body: BosSession = { ...payload, iat: now, exp: now + ttlSeconds };
  const head = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const data = `${head}.${b64url(JSON.stringify(body))}`;
  const sig = await crypto.subtle.sign('HMAC', await key(secret()), encoder.encode(data));
  return `${data}.${b64url(sig)}`;
}

export async function verifySession(token: string | undefined | null): Promise<BosSession | null> {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const data = `${parts[0]}.${parts[1]}`;
    const sigBytes = Uint8Array.from(fromB64url(parts[2]), (c) => c.charCodeAt(0));
    const ok = await crypto.subtle.verify('HMAC', await key(secret()), sigBytes, encoder.encode(data));
    if (!ok) return null;
    const body = JSON.parse(fromB64url(parts[1])) as BosSession;
    if (!body.exp || body.exp < Math.floor(Date.now() / 1000)) return null;
    if (!body.sub || !body.org) return null;
    return body;
  } catch {
    return null;
  }
}

/**
 * ycode keeps four roles (owner > admin > designer > editor). Until the builder's
 * own checks are rewritten against the leaves, derive the role from the flags on
 * `webstudio.manage_sites` and `webstudio.manage_content`.
 */
export function roleFromPermissions(perms: BosSession['perms']): 'owner' | 'admin' | 'designer' | 'editor' | null {
  const sites = perms['webstudio.manage_sites'] || [];
  const content = perms['webstudio.manage_content'] || [];
  if (sites.includes('d')) return 'owner';
  if (sites.includes('c') || sites.includes('u')) return 'admin';
  if (content.includes('c') || content.includes('u')) return 'designer';
  if (content.includes('r') || sites.includes('r')) return 'editor';
  return null;
}

export function hasFlag(session: BosSession | null, leaf: WebStudioLeaf, flag: Flag): boolean {
  return !!session?.perms[leaf]?.includes(flag);
}
