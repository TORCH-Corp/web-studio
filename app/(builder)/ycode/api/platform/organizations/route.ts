import { NextRequest } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { noCache } from '@/lib/api-response';
import { listOrganizations } from '@/lib/platform/organization';
import { provisionOrganization } from '@/lib/platform/provision';

/**
 * Platform-to-platform API (c0 port): Business OS enables Web Studio for an
 * organization by POSTing it here. Protected by the shared platform secret,
 * never by a user session.
 */
function authorised(request: NextRequest): boolean {
  const secret = process.env.BOS_SESSION_SECRET || '';
  const given = request.headers.get('x-platform-secret') || '';
  return !!secret && given.length === secret.length && timingSafeEqual(Buffer.from(given), Buffer.from(secret));
}

export async function GET(request: NextRequest) {
  if (!authorised(request)) return noCache({ error: 'Forbidden' }, 403);
  return noCache({ data: await listOrganizations() });
}

export async function POST(request: NextRequest) {
  if (!authorised(request)) return noCache({ error: 'Forbidden' }, 403);
  const body = await request.json() as { id?: string; name?: string; hosts?: string[]; siteName?: string };
  if (!body.id || !body.name) return noCache({ error: 'id and name are required' }, 400);
  const result = await provisionOrganization({ id: body.id, name: body.name, hosts: body.hosts || [], siteName: body.siteName });
  return noCache({ data: { id: body.id, ...result } }, result.created ? 201 : 200);
}
