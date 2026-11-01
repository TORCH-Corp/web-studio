/**
 * Which domains may a site use? (part 1, session 7)
 *
 * The organization's verified domains live in domain-service (Organization
 * Setup's Domains page). `GET /api/org-setup/domains?entityId=…&status=ACTIVE`
 * with `x-service-api-key` lists the ACTIVE ones. A site's custom host must be
 * one of them, exactly.
 *
 * `WS_DOMAIN_CHECK=off` skips the check and accepts any well-formed host. It
 * exists for an environment whose domain-service cannot be called yet (in
 * production on 1 Nov 2026 its list route reads SERVICE_API_KEY, which is not
 * set there); the pull request that introduced it records that. Any other
 * value, or none, keeps the check on. A check that cannot run is an error, never
 * an allow. Domain verification and DNS are not this file's business.
 *
 * Kept free of Next imports so it runs under `node --test`.
 */

export type DomainCheckMode = 'on' | 'off';

export function domainCheckMode(env: Record<string, string | undefined> = process.env): DomainCheckMode {
  return env.WS_DOMAIN_CHECK?.trim().toLowerCase() === 'off' ? 'off' : 'on';
}

/** domain-service could not be asked, or did not answer as documented. */
export class DomainCheckUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DomainCheckUnavailableError';
  }
}

const TIMEOUT_MS = 5_000;

/** The organization's verified (ACTIVE) domain names, lower case. */
export async function listVerifiedDomains(
  organizationId: string,
  env: Record<string, string | undefined> = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<string[]> {
  const baseUrl = env.DOMAIN_SERVICE_URL?.trim().replace(/\/+$/, '');
  const apiKey = env.DOMAIN_SERVICE_API_KEY?.trim();
  if (!baseUrl || !apiKey) {
    throw new DomainCheckUnavailableError('DOMAIN_SERVICE_URL and DOMAIN_SERVICE_API_KEY are not set (or set WS_DOMAIN_CHECK=off)');
  }

  const url = `${baseUrl}/api/org-setup/domains?${new URLSearchParams({ entityId: organizationId, status: 'ACTIVE' })}`;
  let response: Response;
  try {
    response = await fetchImpl(url, { headers: { 'x-service-api-key': apiKey }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (error) {
    throw new DomainCheckUnavailableError(`domain-service is not reachable: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!response.ok) throw new DomainCheckUnavailableError(`domain-service answered ${response.status}`);

  const body = (await response.json().catch(() => null)) as { items?: Array<{ name?: unknown; status?: unknown }> } | null;
  if (!body || !Array.isArray(body.items)) throw new DomainCheckUnavailableError('domain-service answered with an unexpected body');
  return Array.from(
    new Set(
      body.items
        .filter((item) => item.status === 'ACTIVE' && typeof item.name === 'string')
        .map((item) => (item.name as string).trim().toLowerCase()),
    ),
  );
}

/** True when `host` is one of the verified domains. */
export function isVerifiedDomain(host: string, verified: readonly string[]): boolean {
  return verified.includes(host.trim().toLowerCase());
}
