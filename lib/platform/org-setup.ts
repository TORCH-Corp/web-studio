/**
 * Organization Setup client: the organization's branches (part 2, session W1),
 * the day's exchange rate and the names of units (session W2).
 *
 * Organization Setup is served by auth-service. Its live spec
 * (`https://auth.torchcorp.com/documentation/json`, checked 8 Nov 2026) has two
 * service-to-service branch routes, both guarded by `x-service-api-key` alone
 * (auth-service's own SERVICE_API_KEY, or a key of its per-service registry):
 *
 *   POST /api/internal/branches/          { entityId }   → a bare array of the
 *        organization's ACTIVE branches, every type (hq, branch, warehouse,
 *        retail), ordered by type then name
 *   POST /api/internal/branches/by-ids    { branchIds }  → { branches: [...] },
 *        archived branches included and NO organization filter: the caller
 *        checks `entityId` itself
 *
 * The user-facing `GET /org-setup/branches` needs a user token with Organization
 * Setup access, which a Web Studio user may not have; Sales and queue-service
 * call the internal route with the service key for that reason. On production
 * (8 Nov 2026, read only) the internal route answered 200 with the service key
 * and 401 without one, so this client uses the service key and never the
 * user's token.
 *
 * Session W2 adds two service-to-service reads, from the same live spec (8 Nov
 * 2026), guarded by `x-service-api-key` and `x-entity-id` (the organization),
 * the calls Sales makes for a document line:
 *
 *   GET  /api/internal/org-setup/exchange-rates/as-of?from&to&date&rate_type
 *        → { success, data: { found, rate?, effective_date?, … } }: the latest
 *        rate of the type on or before the date, or a cross-rate through the
 *        primary base currency; `found: false` when none resolves, never an
 *        error. It never inverts a pair: on production (8 Nov 2026, read only)
 *        USD→IQD answered 1520 and IQD→USD `found: false`.
 *   POST /api/internal/org-setup/uoms/lookup  { ids } (1 to 200)
 *        → { success, data: [{ id, code, symbol, name, status }] }, archived
 *        units included, an unknown id left out.
 *
 * Session W5 (part 3) adds the two reads that say who is told of a new form
 * submission, the calls Sales makes for a storefront order's notification (its
 * `order-platform.ts`, `storefrontOrderRecipients`), with the same key:
 *
 *   POST /api/internal/people/members  { entityId, limit } (limit up to 500)
 *        → { people: [{ id, displayName, avatarUrl }], nextCursor }: the
 *          organization's active members in user-id order, `nextCursor` not
 *          null when there are more. No read gives the holders of a flag, nor a
 *          site's members, so the caller asks the flag of each member.
 *   POST /api/internal/authz/evaluate  { userId, entityId, leafKey, flag }
 *        → { allowed: boolean }: the user's own profile in the organization
 *          (libs/service-utils `AuthAuthzClient`, which Sales's holder lookup
 *          goes through). Guarded by `x-service-api-key` alone.
 *
 * ORG_SETUP_URL and ORG_SETUP_API_KEY come from the environment. Kept free of
 * Next imports so it runs under `node --test`.
 */

import { decimalFromNumber } from '@/lib/platform/store-money';

export interface Branch {
  id: string;
  name: string;
  code: string;
  type: string;
  status: string;
  entityId: string;
}

/** Organization Setup is not configured, cannot be reached, or did not answer as its spec says. */
export class OrgSetupUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OrgSetupUnavailableError';
  }
}

type Env = Record<string, string | undefined>;

const TIMEOUT_MS = 5_000;
/** auth-service's limit for one by-ids call. */
const BY_IDS_MAX = 500;

function config(env: Env): { baseUrl: string; apiKey: string } {
  const baseUrl = env.ORG_SETUP_URL?.trim().replace(/\/+$/, '');
  const apiKey = env.ORG_SETUP_API_KEY?.trim();
  if (!baseUrl || !apiKey) throw new OrgSetupUnavailableError('ORG_SETUP_URL and ORG_SETUP_API_KEY are not set');
  return { baseUrl, apiKey };
}

interface Call {
  method: 'GET' | 'POST';
  body?: unknown;
  /** Sent as x-entity-id: the routes of session W2 act in an organization; the branch routes take it in the body. */
  organizationId?: string;
}

async function call(op: string, path: string, init: Call, env: Env, fetchImpl: typeof fetch): Promise<unknown> {
  const { baseUrl, apiKey } = config(env);
  const headers: Record<string, string> = { 'x-service-api-key': apiKey };
  if (init.body !== undefined) headers['content-type'] = 'application/json';
  if (init.organizationId) headers['x-entity-id'] = init.organizationId;
  let response: Response;
  try {
    response = await fetchImpl(`${baseUrl}${path}`, {
      method: init.method,
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    throw new OrgSetupUnavailableError(`Organization Setup is not reachable (${op}): ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 200);
    throw new OrgSetupUnavailableError(`Organization Setup answered ${response.status} to ${op}${detail ? `: ${detail}` : ''}`);
  }
  const parsed = await response.json().catch(() => undefined);
  if (parsed === undefined) throw new OrgSetupUnavailableError(`Organization Setup answered ${op} with a body that is not JSON`);
  return parsed;
}

function toBranch(row: unknown): Branch | null {
  if (!row || typeof row !== 'object') return null;
  const value = row as Record<string, unknown>;
  const text = (key: string) => (typeof value[key] === 'string' ? (value[key] as string) : null);
  const id = text('id');
  const name = text('name');
  const entityId = text('entityId');
  if (!id || !name || !entityId) return null;
  return { id, name, entityId, code: text('code') ?? '', type: text('type') ?? '', status: text('status') ?? '' };
}

function branchesFrom(op: string, rows: unknown): Branch[] {
  if (!Array.isArray(rows)) throw new OrgSetupUnavailableError(`Organization Setup answered ${op} with an unexpected body`);
  return rows.map((row) => {
    const branch = toBranch(row);
    if (!branch) throw new OrgSetupUnavailableError(`Organization Setup answered ${op} with a branch that has no id, name or organization`);
    return branch;
  });
}

/** The organization's active branches, in Organization Setup's order (type, then name). */
export async function listBranches(organizationId: string, env: Env = process.env, fetchImpl: typeof fetch = fetch): Promise<Branch[]> {
  const op = 'POST /api/internal/branches/';
  const rows = branchesFrom(op, await call(op, '/api/internal/branches/', { method: 'POST', body: { entityId: organizationId } }, env, fetchImpl));
  // The route filters by organization and status already; a row of another one would be a bug there, never shown here.
  return rows.filter((branch) => branch.entityId === organizationId && branch.status === 'active');
}

/**
 * Branches of the organization by id, archived ones included (their names still
 * resolve). An id that is unknown, or another organization's, is absent.
 */
export async function findBranches(organizationId: string, ids: string[], env: Env = process.env, fetchImpl: typeof fetch = fetch): Promise<Branch[]> {
  const unique = Array.from(new Set(ids));
  if (!unique.length) return [];
  if (unique.length > BY_IDS_MAX) throw new Error(`At most ${BY_IDS_MAX} branch ids per lookup`);
  const op = 'POST /api/internal/branches/by-ids';
  const body = (await call(op, '/api/internal/branches/by-ids', { method: 'POST', body: { branchIds: unique } }, env, fetchImpl)) as { branches?: unknown } | null;
  return branchesFrom(op, body?.branches).filter((branch) => branch.entityId === organizationId);
}

/** auth-service's limit for one unit lookup. */
const UNIT_IDS_MAX = 200;

/** A unit of measure as a storefront line names it. */
export interface Unit {
  id: string;
  /** The unit as people write it (pcs, L). */
  symbol: string;
  /** The unit's name (Piece, Litre). */
  name: string;
}

/**
 * The USD→IQD spot rate in force on `day` (YYYY-MM-DD) in the organization, as
 * an exact decimal string (IQD per USD); null when Organization Setup has none
 * for the day, which is an answer, not an error. The one rate the storefront
 * converts with, both ways (lib/platform/store-money.ts).
 */
export async function usdIqdRate(organizationId: string, day: string, env: Env = process.env, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  const op = 'GET /api/internal/org-setup/exchange-rates/as-of';
  const query = new URLSearchParams({ from: 'USD', to: 'IQD', date: day, rate_type: 'spot' });
  const body = (await call(op, `/api/internal/org-setup/exchange-rates/as-of?${query}`, { method: 'GET', organizationId }, env, fetchImpl)) as { success?: unknown; data?: { found?: unknown; rate?: unknown } } | null;
  const data = body?.data;
  if (body?.success !== true || !data || typeof data.found !== 'boolean') throw new OrgSetupUnavailableError(`Organization Setup answered ${op} with an unexpected body`);
  if (!data.found) return null;
  const rate = decimalFromNumber(data.rate, 8);
  if (rate === null) throw new OrgSetupUnavailableError(`Organization Setup answered ${op} with a rate that is not a number`);
  // A rate of zero would price everything at nothing: it is no rate. (decimalFromNumber writes zero as "0".)
  return rate === '0' ? null : rate;
}

/** The organization's units with these ids, archived ones included; an id it has no unit for is absent. Calls of 200 ids, one after another. */
export async function findUnits(organizationId: string, ids: string[], env: Env = process.env, fetchImpl: typeof fetch = fetch): Promise<Map<string, Unit>> {
  const op = 'POST /api/internal/org-setup/uoms/lookup';
  const unique = Array.from(new Set(ids));
  const units = new Map<string, Unit>();
  for (let start = 0; start < unique.length; start += UNIT_IDS_MAX) {
    const body = (await call(op, '/api/internal/org-setup/uoms/lookup', { method: 'POST', body: { ids: unique.slice(start, start + UNIT_IDS_MAX) }, organizationId }, env, fetchImpl)) as { success?: unknown; data?: unknown } | null;
    if (body?.success !== true || !Array.isArray(body.data)) throw new OrgSetupUnavailableError(`Organization Setup answered ${op} with an unexpected body`);
    for (const row of body.data) {
      const value = (row && typeof row === 'object' ? row : {}) as Record<string, unknown>;
      if (typeof value.id !== 'string' || typeof value.symbol !== 'string' || typeof value.name !== 'string') {
        throw new OrgSetupUnavailableError(`Organization Setup answered ${op} with a unit that has no id, symbol or name`);
      }
      units.set(value.id, { id: value.id, symbol: value.symbol, name: value.name });
    }
  }
  return units;
}

/** auth-service's limit for one member read. */
const MEMBERS_MAX = 500;

/**
 * The first `limit` active members of the organization (their ids, in user-id
 * order) from one call, and whether there are more. For a read that must be
 * bounded: who a new submission is told to.
 */
export async function listMemberIds(organizationId: string, limit: number, env: Env = process.env, fetchImpl: typeof fetch = fetch): Promise<{ ids: string[]; hasMore: boolean }> {
  if (!Number.isInteger(limit) || limit < 1 || limit > MEMBERS_MAX) throw new Error(`Read at most ${MEMBERS_MAX} members at a time`);
  const op = 'POST /api/internal/people/members';
  const body = (await call(op, '/api/internal/people/members', { method: 'POST', body: { entityId: organizationId, limit }, organizationId }, env, fetchImpl)) as { people?: unknown; nextCursor?: unknown } | null;
  if (!Array.isArray(body?.people)) throw new OrgSetupUnavailableError(`Organization Setup answered ${op} with an unexpected body`);
  const ids = body.people.map((person) => (person && typeof person === 'object' ? (person as { id?: unknown }).id : undefined));
  if (!ids.every((id): id is string => typeof id === 'string' && id !== '')) throw new OrgSetupUnavailableError(`Organization Setup answered ${op} with a member that has no id`);
  return { ids, hasMore: typeof body.nextCursor === 'string' };
}

/**
 * Whether the user holds the flag on the leaf in the organization, from their
 * own profile. A check that was not answered is an error and never a no, so a
 * caller can tell "not allowed" from "could not ask".
 */
export async function userHolds(organizationId: string, userId: string, leafKey: string, flag: string, env: Env = process.env, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  const op = 'POST /api/internal/authz/evaluate';
  const body = (await call(op, '/api/internal/authz/evaluate', { method: 'POST', body: { userId, entityId: organizationId, leafKey, flag }, organizationId }, env, fetchImpl)) as { allowed?: unknown } | null;
  if (typeof body?.allowed !== 'boolean') throw new OrgSetupUnavailableError(`Organization Setup answered ${op} with an unexpected body`);
  return body.allowed;
}
