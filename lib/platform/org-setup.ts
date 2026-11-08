/**
 * Organization Setup client (part 2, session W1): the organization's branches.
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
 * ORG_SETUP_URL and ORG_SETUP_API_KEY come from the environment. Kept free of
 * Next imports so it runs under `node --test`.
 */

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

async function post(op: string, path: string, body: unknown, env: Env, fetchImpl: typeof fetch): Promise<unknown> {
  const { baseUrl, apiKey } = config(env);
  let response: Response;
  try {
    response = await fetchImpl(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'x-service-api-key': apiKey, 'content-type': 'application/json' },
      body: JSON.stringify(body),
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
  const rows = branchesFrom(op, await post(op, '/api/internal/branches/', { entityId: organizationId }, env, fetchImpl));
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
  const body = (await post(op, '/api/internal/branches/by-ids', { branchIds: unique }, env, fetchImpl)) as { branches?: unknown } | null;
  return branchesFrom(op, body?.branches).filter((branch) => branch.entityId === organizationId);
}
