import { NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE, signSession, type BosSession, type Flag } from '@/lib/platform/session';
import { FLAGS, WEB_STUDIO_LEAVES } from '@/lib/platform/web-studio-scope';
import { noCache } from '@/lib/api-response';

/** The Manager's defaults: every flag on every leaf. */
const EVERY_FLAG: BosSession['perms'] = Object.fromEntries(WEB_STUDIO_LEAVES.map((leaf) => [leaf, [...FLAGS] as Flag[]]));

/**
 * POST /ycode/api/auth/dev-login — a developer's machine and the e2e suite only.
 *
 * Stands in for the shell and auth-service: issues a Web Studio session for a
 * user of one organization with the given permission flags (by default every
 * flag on every leaf, the Manager's). Enabled only when ALLOW_DEV_LOGIN=true;
 * production receives the session from the Business OS access token through
 * GET /ycode/api/auth/callback. The site is chosen afterwards with
 * GET /ycode/api/platform/sites/{id}/open.
 */
export async function POST(request: NextRequest) {
  if (process.env.ALLOW_DEV_LOGIN !== 'true') {
    return noCache({ error: 'Sign-in happens in Business OS' }, 404);
  }
  const body = await request.json() as Partial<Omit<BosSession, 'iat' | 'exp'>>;
  if (!body.sub || !body.org || !body.email) {
    return noCache({ error: 'sub, email and org are required' }, 400);
  }
  const token = await signSession({
    sub: body.sub,
    email: body.email,
    name: body.name || body.email,
    org: body.org,
    perms: body.perms ?? EVERY_FLAG,
  });
  const response = NextResponse.json({ ok: true, organization: body.org });
  response.cookies.set({ name: SESSION_COOKIE, value: token, path: '/', httpOnly: true, sameSite: 'lax', maxAge: 8 * 3600 });
  return response;
}
