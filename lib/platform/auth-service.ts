/**
 * What Web Studio asks auth-service with the user's own access token (part 1,
 * session 2), checked against the live spec at /documentation/json on 1 Nov 2026:
 *
 *   GET /authz/my-permissions?namespace=webstudio
 *       a bare object, leaf key -> { c, r, u, d, x, export?, use_ai?, execute? }
 *       (booleans; no envelope). `namespace` keeps only `webstudio.*`.
 *   GET /authz/my-permissions?namespace=sales   (part 2, session W8)
 *       the same map for the Sales leaves. The callback keeps one flag of it, x on sales.manage_orders, so the
 *       app can show confirm and cancel only to a user Sales will accept (the Orders API; Sales checks it again).
 *   GET /users/me
 *       the user's profile: id, email, name, firstName, lastName, ... (bare object).
 *       The access token carries no name claim, so this is where the name is.
 *
 * BOS_AUTH_URL names the service (inside the platform network
 * http://auth-service:6001; the public host is the default).
 */

import type { BosSession, Flag, WebStudioLeaf } from './session';
import { FLAGS, WEB_STUDIO_LEAVES } from './web-studio-scope';

/** Environment variables by name, as process.env or a test's object. */
export type Env = Record<string, string | undefined>;

const TIMEOUT_MS = 10_000;

/** auth-service could not be reached or did not answer as the spec says. `status` is its HTTP status, null when unreachable. */
export class AuthServiceError extends Error {
  constructor(message: string, readonly status: number | null) {
    super(message);
    this.name = 'AuthServiceError';
  }
}

export function authServiceUrl(env: Env = process.env): string {
  return (env.BOS_AUTH_URL || 'https://auth.torchcorp.com').replace(/\/+$/, '');
}

async function authGet<T>(path: string, token: string, env: Env): Promise<T> {
  const url = `${authServiceUrl(env)}${path}`;
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    throw new AuthServiceError(`auth-service could not be reached at ${url}: ${error instanceof Error ? error.message : String(error)}`, null);
  }
  if (!response.ok) {
    throw new AuthServiceError(`auth-service answered ${response.status} at ${url}`, response.status);
  }
  try {
    return (await response.json()) as T;
  } catch {
    throw new AuthServiceError(`auth-service answered with a body that is not JSON at ${url}`, response.status);
  }
}

/**
 * The Web Studio flags of a my-permissions map: only the webstudio leaves, only
 * the flags that are true, only the seven flags the platform defines (the
 * `execute` drill-down object and anything unknown are dropped).
 */
export function permissionsFromLeafMap(map: unknown, leaves: readonly WebStudioLeaf[] = WEB_STUDIO_LEAVES): BosSession['perms'] {
  const perms: BosSession['perms'] = {};
  if (!map || typeof map !== 'object') return perms;
  for (const leaf of leaves) {
    const flags = (map as Record<string, unknown>)[leaf];
    if (!flags || typeof flags !== 'object') continue;
    const granted = FLAGS.filter((flag) => (flags as Record<string, unknown>)[flag] === true);
    if (granted.length > 0) perms[leaf] = granted as Flag[];
  }
  return perms;
}

export function hasAnyPermission(perms: BosSession['perms']): boolean {
  return Object.values(perms).some((flags) => flags && flags.length > 0);
}

export async function fetchWebStudioPermissions(token: string, env: Env = process.env): Promise<BosSession['perms']> {
  return permissionsFromLeafMap(await authGet<unknown>('/authz/my-permissions?namespace=webstudio', token, env));
}

/** The Sales leaf whose x flag lets a user confirm or cancel an order in Sales. */
export const SALES_ORDERS_LEAF = 'sales.manage_orders';

/** Does a my-permissions map give the user x on sales.manage_orders? Only that flag of only that leaf. */
export function canExecuteSalesOrders(map: unknown): boolean {
  if (!map || typeof map !== 'object') return false;
  const flags = (map as Record<string, unknown>)[SALES_ORDERS_LEAF];
  return !!flags && typeof flags === 'object' && (flags as Record<string, unknown>).x === true;
}

export async function fetchSalesOrdersExecute(token: string, env: Env = process.env): Promise<boolean> {
  return canExecuteSalesOrders(await authGet<unknown>('/authz/my-permissions?namespace=sales', token, env));
}

export interface CurrentUser {
  id: string;
  email: string;
  name: string | null;
  firstName: string | null;
  lastName: string | null;
}

export async function fetchCurrentUser(token: string, env: Env = process.env): Promise<CurrentUser> {
  const me = await authGet<Partial<CurrentUser>>('/users/me', token, env);
  if (typeof me?.id !== 'string' || typeof me.email !== 'string') {
    throw new AuthServiceError('auth-service answered /users/me without an id and an email', 200);
  }
  return { id: me.id, email: me.email, name: me.name ?? null, firstName: me.firstName ?? null, lastName: me.lastName ?? null };
}

/** The name the builder shows: the profile name, else first and last name, else the email. */
export function displayName(user: Pick<CurrentUser, 'name' | 'firstName' | 'lastName' | 'email'>): string {
  const name = user.name?.trim();
  if (name) return name;
  const parts = [user.firstName, user.lastName].map((part) => part?.trim()).filter(Boolean).join(' ');
  return parts || user.email;
}
