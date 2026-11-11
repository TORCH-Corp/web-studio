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
 *   POST /api/v1/directory/lookup-ids   { ids } (1 to 100)  (part 2, session W8)
 *        → { success, data: { <id>: { id, entityKind, name, code, phone, email, status, … } } }: keyed by the id
 *          as submitted, an id Contact Center does not have is absent, `status` is ACTIVE or ARCHIVED. The same
 *          guard as the route above; Sales reads its customers with it, in chunks of 100. The Orders list shows the
 *          buyer's name and phone from it: Web Studio keeps no buyer data.
 *
 *   POST /api/v1/internal/prospects/find-or-create   { name, phone, email?, notes?, origin: 'web_form' }  (part 3, session W3)
 *        → 200 { kind: 'contact', id } when a live person holds the phone in its canonical form (no prospect is
 *          made), 200 { kind: 'prospect', id, created: false } when a prospect that is not converted holds it (the
 *          notes are added to its notes under the day), 201 { kind: 'prospect', id, created: true } for a new
 *          prospect, source WEB_FORM. The same guard as the routes above; 400 for a body its schema refuses (name 1
 *          to 255, phone 1 to 20, email an address of up to 255, notes up to 5000). From the route's code
 *          (torch-core-backend 3123625d, `apps/contact-center-service/src/app/domains/internal-prospects`).
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

/** What a web form's submission is in Contact Center: the prospect with its phone, made when no one holds it, or the contact who does. */
export async function findOrCreateProspect(
  organizationId: string,
  prospect: { name: string; phone: string; email?: string; notes?: string },
  timeoutMs: number = TIMEOUT_MS,
  env: Env = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<{ kind: 'prospect' | 'contact'; id: string }> {
  const op = 'POST /api/v1/internal/prospects/find-or-create';
  const { baseUrl, apiKey } = config(env);
  let response: Response;
  try {
    response = await fetchImpl(`${baseUrl}/api/v1/internal/prospects/find-or-create`, {
      method: 'POST',
      headers: { 'x-service-api-key': apiKey, 'x-entity-id': organizationId, 'content-type': 'application/json' },
      body: JSON.stringify({ name: prospect.name, phone: prospect.phone, email: prospect.email, notes: prospect.notes, origin: 'web_form' }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new ContactCenterUnavailableError(`Contact Center is not reachable (${op}): ${error instanceof Error ? error.message : String(error)}`);
  }
  if (response.status !== 200 && response.status !== 201) {
    const detail = (await response.text().catch(() => '')).slice(0, 200);
    throw new ContactCenterUnavailableError(`Contact Center answered ${response.status} to ${op}${detail ? `: ${detail}` : ''}`);
  }
  const body = (await response.json().catch(() => undefined)) as { kind?: unknown; id?: unknown } | undefined;
  if (!body || (body.kind !== 'prospect' && body.kind !== 'contact') || typeof body.id !== 'string' || !UUID.test(body.id)) {
    throw new ContactCenterUnavailableError(`Contact Center answered ${op} with an unexpected body`);
  }
  return { kind: body.kind, id: body.id.toLowerCase() };
}

/** A contact as the Orders list shows a buyer. */
export interface DirectoryContact {
  id: string;
  name: string;
  phone: string | null;
  archived: boolean;
}

const LOOKUP_IDS_MAX = 100;
const LOOKUP_TIMEOUT_MS = 5_000;

function toContact(value: unknown): DirectoryContact | null {
  if (typeof value !== 'object' || value === null) return null;
  const { id, name, phone, status } = value as Record<string, unknown>;
  if (typeof id !== 'string' || typeof name !== 'string' || (phone !== null && typeof phone !== 'string') || typeof status !== 'string') return null;
  return { id, name, phone, archived: status === 'ARCHIVED' };
}

/** The contacts of the organization with these ids, keyed by id; an id Contact Center does not have is absent. */
export async function lookupContacts(
  organizationId: string,
  ids: string[],
  env: Env = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<Map<string, DirectoryContact>> {
  const op = 'POST /api/v1/directory/lookup-ids';
  const unique = Array.from(new Set(ids));
  const found = new Map<string, DirectoryContact>();
  if (unique.length === 0) return found;
  const { baseUrl, apiKey } = config(env);
  for (let start = 0; start < unique.length; start += LOOKUP_IDS_MAX) {
    let response: Response;
    try {
      response = await fetchImpl(`${baseUrl}/api/v1/directory/lookup-ids`, {
        method: 'POST',
        headers: { 'x-service-api-key': apiKey, 'x-entity-id': organizationId, 'content-type': 'application/json' },
        body: JSON.stringify({ ids: unique.slice(start, start + LOOKUP_IDS_MAX) }),
        signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
      });
    } catch (error) {
      throw new ContactCenterUnavailableError(`Contact Center is not reachable (${op}): ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!response.ok) {
      const detail = (await response.text().catch(() => '')).slice(0, 200);
      throw new ContactCenterUnavailableError(`Contact Center answered ${response.status} to ${op}${detail ? `: ${detail}` : ''}`);
    }
    const body = (await response.json().catch(() => undefined)) as { success?: unknown; data?: unknown } | undefined;
    if (body?.success !== true || typeof body.data !== 'object' || body.data === null) {
      throw new ContactCenterUnavailableError(`Contact Center answered ${op} with an unexpected body`);
    }
    for (const row of Object.values(body.data)) {
      const contact = toContact(row);
      if (!contact) throw new ContactCenterUnavailableError(`Contact Center answered ${op} with a contact it cannot read`);
      found.set(contact.id, contact);
    }
  }
  return found;
}
