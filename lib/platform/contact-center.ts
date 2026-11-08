/**
 * Contact Center client: the buyer of a storefront checkout as a person
 * contact (part 2, session W3; PRD V1.1 "Contact Center", light path C1).
 *
 * From Contact Center's live spec (`https://contact-center.torchcorp.com/documentation/json`,
 * checked 8 Nov 2026) and the route's code (torch-core-backend cdffabad,
 * `apps/contact-center-service/src/app/domains/internal-persons`):
 *
 *   POST /api/v1/internal/persons/find-or-create   { name, phone, origin: 'storefront' }
 *        → 200 { person_id, created: false } for the organization's live
 *          person whose phone matches in its canonical form (country code 964;
 *          the oldest when several do), or 201 { person_id, created: true }
 *          for a new person, first and last name split at the first space, the
 *          phone stored as given, origin storefront. Two calls at once with
 *          one number create one person. No envelope.
 *        Guarded by `x-service-api-key` (Contact Center's SERVICE_API_KEY) and
 *        `x-entity-id` (the organization) alone; a user token is 403. 400 for
 *        a name or phone the route refuses (Web Studio's rules are stricter).
 *
 * Web Studio sends the canonical form (964 and the national digits), so the
 * person a checkout creates carries one form whatever the buyer typed; the
 * number as typed goes on the Sales order's delivery address.
 *
 * CONTACT_CENTER_URL and CONTACT_CENTER_API_KEY come from the environment.
 * Kept free of Next imports so it runs under `node --test`.
 */

/** Contact Center is not configured, cannot be reached, or did not answer as its spec says. */
export class ContactCenterUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContactCenterUnavailableError';
  }
}

type Env = Record<string, string | undefined>;

/** A write that makes at most one row; a person made after the timeout is found by the retry. */
const TIMEOUT_MS = 10_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function config(env: Env): { baseUrl: string; apiKey: string } {
  const baseUrl = env.CONTACT_CENTER_URL?.trim().replace(/\/+$/, '');
  const apiKey = env.CONTACT_CENTER_API_KEY?.trim();
  if (!baseUrl || !apiKey) throw new ContactCenterUnavailableError('CONTACT_CENTER_URL and CONTACT_CENTER_API_KEY are not set');
  return { baseUrl, apiKey };
}

/** The person of the organization with this phone, made when there is none. */
export async function findOrCreatePerson(
  organizationId: string,
  buyer: { name: string; phone: string },
  env: Env = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<{ personId: string; created: boolean }> {
  const op = 'POST /api/v1/internal/persons/find-or-create';
  const { baseUrl, apiKey } = config(env);
  let response: Response;
  try {
    response = await fetchImpl(`${baseUrl}/api/v1/internal/persons/find-or-create`, {
      method: 'POST',
      headers: { 'x-service-api-key': apiKey, 'x-entity-id': organizationId, 'content-type': 'application/json' },
      body: JSON.stringify({ name: buyer.name, phone: buyer.phone, origin: 'storefront' }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    throw new ContactCenterUnavailableError(`Contact Center is not reachable (${op}): ${error instanceof Error ? error.message : String(error)}`);
  }
  if (response.status !== 200 && response.status !== 201) {
    const detail = (await response.text().catch(() => '')).slice(0, 200);
    throw new ContactCenterUnavailableError(`Contact Center answered ${response.status} to ${op}${detail ? `: ${detail}` : ''}`);
  }
  const body = (await response.json().catch(() => undefined)) as { person_id?: unknown; created?: unknown } | undefined;
  if (!body || typeof body.person_id !== 'string' || !UUID.test(body.person_id) || typeof body.created !== 'boolean') {
    throw new ContactCenterUnavailableError(`Contact Center answered ${op} with an unexpected body`);
  }
  return { personId: body.person_id.toLowerCase(), created: body.created };
}
