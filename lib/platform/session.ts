/**
 * Business OS session for Web Studio (c0 port).
 *
 * The builder trusts a signed session issued by Business OS Auth and carried
 * in the `bos_session` cookie: who the user is, which organization they are
 * working in, and their Web Studio permission flags. Nothing here creates
 * users; the only issuer in this prototype is the dev login route, which
 * stands in for `auth-service`.
 *
 * The site the builder is working on travels in a second signed cookie,
 * `ws_site`, minted by `GET /ycode/api/platform/sites/{id}/open` once the
 * site is known to belong to the session's organization. It carries the
 * organization too, so the proxy can refuse a cookie from another
 * organization without a database lookup.
 *
 * Web Crypto is used so the same code runs in the Next proxy and in route
 * handlers.
 */

export const SESSION_COOKIE = 'bos_session';
export const SITE_COOKIE = 'ws_site';

/** The attributes every Web Studio cookie carries. */
export interface CookieAttributes {
  path: '/';
  httpOnly: true;
  sameSite: 'lax';
  secure: boolean;
}

/**
 * Attributes for the session and site cookies. `Secure` follows the request's scheme:
 * nginx terminates TLS in front of the service and says so in X-Forwarded-Proto, so a
 * cookie minted on production is only ever sent back over HTTPS. A plain-HTTP request
 * (the local e2e run, a developer's machine) gets no Secure flag, which a browser would
 * otherwise refuse to store. auth-service and ycode's page-auth cookie decide by
 * NODE_ENV instead; here the local e2e suite runs the production build over HTTP, so
 * the request is the better witness.
 */
export function cookieAttributes(headers: Headers, url: { protocol: string }): CookieAttributes {
  const forwarded = headers.get('x-forwarded-proto')?.split(',')[0]?.trim().toLowerCase();
  const secure = forwarded ? forwarded === 'https' : url.protocol === 'https:';
  return { path: '/', httpOnly: true, sameSite: 'lax', secure };
}

/** Web Studio permission leaves, one per area of the app, with the standard flags. */
export type WebStudioLeaf = 'webstudio.manage_sites' | 'webstudio.manage_content' | 'webstudio.manage_forms' | 'webstudio.manage_orders' | 'webstudio.manage_reports';
export type Flag = 'c' | 'r' | 'u' | 'd' | 'x' | 'export' | 'use_ai';

export interface BosSession {
  sub: string;
  email: string;
  name: string;
  org: string;
  perms: Partial<Record<WebStudioLeaf, Flag[]>>;
  /**
   * The user's x flag on Sales's sales.manage_orders, read at sign-in (part 2, session W8): the app shows confirm
   * and cancel only when this and webstudio.manage_orders x are both true. Sales checks the user again on every
   * change. A cookie from before this field has none, which reads as false.
   */
  sales_manage_orders_x?: boolean;
  iat: number;
  exp: number;
}

/** The site a builder session works on, and the organization it was checked against. */
export interface SiteCookie {
  site: string;
  org: string;
  iat: number;
  exp: number;
}

const SESSION_TYP = 'JWT';
const SITE_TYP = 'ws_site';
const DEFAULT_TTL_SECONDS = 8 * 3600;

const encoder = new TextEncoder();

export function b64url(input: ArrayBuffer | string): string {
  const bytes = typeof input === 'string' ? encoder.encode(input) : new Uint8Array(input);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromB64url(s: string): string {
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

async function sign<T extends object>(typ: string, body: T): Promise<string> {
  const head = b64url(JSON.stringify({ alg: 'HS256', typ }));
  const data = `${head}.${b64url(JSON.stringify(body))}`;
  const sig = await crypto.subtle.sign('HMAC', await key(secret()), encoder.encode(data));
  return `${data}.${b64url(sig)}`;
}

/** The body of a token whose signature, type and expiry check out; null otherwise. */
async function verify<T extends { exp?: number }>(typ: string, token: string | undefined | null): Promise<T | null> {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const head = JSON.parse(fromB64url(parts[0])) as { typ?: string };
    if (head.typ !== typ) return null;
    const data = `${parts[0]}.${parts[1]}`;
    const sigBytes = Uint8Array.from(fromB64url(parts[2]), (c) => c.charCodeAt(0));
    const ok = await crypto.subtle.verify('HMAC', await key(secret()), sigBytes, encoder.encode(data));
    if (!ok) return null;
    const body = JSON.parse(fromB64url(parts[1])) as T;
    if (!body.exp || body.exp < Math.floor(Date.now() / 1000)) return null;
    return body;
  } catch {
    return null;
  }
}

export async function signSession(payload: Omit<BosSession, 'iat' | 'exp'>, ttlSeconds = DEFAULT_TTL_SECONDS): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const body: BosSession = { ...payload, iat: now, exp: now + ttlSeconds };
  return sign(SESSION_TYP, body);
}

export async function verifySession(token: string | undefined | null): Promise<BosSession | null> {
  const body = await verify<BosSession>(SESSION_TYP, token);
  if (!body || !body.sub || !body.org) return null;
  return body;
}

export async function signSiteCookie(payload: Pick<SiteCookie, 'site' | 'org'>, ttlSeconds = DEFAULT_TTL_SECONDS): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const body: SiteCookie = { site: payload.site, org: payload.org, iat: now, exp: now + ttlSeconds };
  return sign(SITE_TYP, body);
}

export async function verifySiteCookie(token: string | undefined | null): Promise<SiteCookie | null> {
  const body = await verify<SiteCookie>(SITE_TYP, token);
  if (!body || !body.site || !body.org) return null;
  return body;
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

export function hasSalesOrdersExecute(session: BosSession | null): boolean {
  return session?.sales_manage_orders_x === true;
}

export function hasFlag(session: BosSession | null, leaf: WebStudioLeaf, flag: Flag): boolean {
  return !!session?.perms[leaf]?.includes(flag);
}
