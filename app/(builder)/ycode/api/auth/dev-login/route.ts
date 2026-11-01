import { NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE, signSession, type BosSession } from '@/lib/platform/session';
import { noCache } from '@/lib/api-response';

/**
 * POST /ycode/api/auth/dev-login — c0 prototype only.
 *
 * Stands in for Business OS `auth-service`: issues a Web Studio session for a
 * user of one organization with the given permission flags. Enabled only when
 * ALLOW_DEV_LOGIN=true; production receives the session from Business OS.
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
    perms: body.perms || { 'webstudio.manage_sites': ['c', 'r', 'u', 'd', 'x'], 'webstudio.manage_content': ['c', 'r', 'u', 'd'], 'webstudio.manage_forms': ['r', 'u', 'd', 'export'], 'webstudio.manage_orders': ['r', 'u'] },
  });
  const response = NextResponse.json({ ok: true, organization: body.org });
  response.cookies.set({ name: SESSION_COOKIE, value: token, path: '/', httpOnly: true, sameSite: 'lax', maxAge: 8 * 3600 });
  return response;
}
