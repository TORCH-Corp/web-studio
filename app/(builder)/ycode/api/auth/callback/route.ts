import { NextRequest, NextResponse } from 'next/server';
import { noCache } from '@/lib/api-response';
import { PublicKeyNotConfiguredError, verifyAccessToken } from '@/lib/platform/access-token';
import { AuthServiceError, displayName, fetchCurrentUser, fetchWebStudioPermissions, hasAnyPermission } from '@/lib/platform/auth-service';
import { SESSION_COOKIE, SITE_COOKIE, signSession, signSiteCookie, verifySession, verifySiteCookie } from '@/lib/platform/session';
import { sessionView } from '@/lib/platform/session-view';
import { getSiteForOrganization, type Site } from '@/lib/platform/site';

/**
 * GET /ycode/api/auth/callback?token=<access token>[&site=<site id>]
 *
 * Token in, cookie out (part 1, session 2). The shell opens the builder here
 * with the user's Business OS access token. The token is verified with
 * auth-service's public key (BOS_JWT_PUBLIC_KEY); the user's Web Studio flags
 * come from GET /authz/my-permissions and the name from GET /users/me, both
 * with the same token; and the `bos_session` cookie is minted for the user,
 * the organization the token names (`entityId`) and the flags, living as long
 * as the token. A user with no Web Studio flag at all gets no cookie (403).
 *
 * With `site`, the site is checked to be a live site of that organization and
 * the `ws_site` cookie is set too, as GET /ycode/api/platform/sites/{id}/open
 * does. Without it, the site the builder is already on is kept for as long as
 * the new session.
 *
 * A browser navigation is sent on to /ycode (303). A fetch that asks for JSON
 * (the builder renewing its session, lib/platform/browser-session.ts) gets the
 * session view instead, so the page keeps its state.
 */
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token');
  const siteId = request.nextUrl.searchParams.get('site');
  if (!token) return noCache({ error: 'token is required' }, 400);

  let claims;
  try {
    claims = await verifyAccessToken(token);
  } catch (error) {
    if (error instanceof PublicKeyNotConfiguredError) {
      console.error('[GET /ycode/api/auth/callback]', error.message);
      return noCache({ error: 'Web Studio cannot verify Business OS tokens: BOS_JWT_PUBLIC_KEY is not configured' }, 500);
    }
    throw error;
  }
  if (!claims) return noCache({ error: 'The access token is not valid or has expired' }, 401);
  if (!claims.entityId) return noCache({ error: 'The access token names no organization' }, 403);
  const organization = claims.entityId;

  let perms;
  let me;
  try {
    [perms, me] = await Promise.all([fetchWebStudioPermissions(token), fetchCurrentUser(token)]);
  } catch (error) {
    if (error instanceof AuthServiceError) {
      if (error.status === 401) return noCache({ error: 'Business OS did not accept the access token' }, 401);
      console.error('[GET /ycode/api/auth/callback]', error.message);
      return noCache({ error: 'Business OS auth did not answer; try again' }, 502);
    }
    throw error;
  }
  if (!hasAnyPermission(perms)) {
    return noCache({ error: 'No Web Studio permission in this organization', organization }, 403);
  }

  let site: Site | null = null;
  if (siteId) {
    site = await getSiteForOrganization(siteId, organization);
    if (!site) return noCache({ error: 'Site not found' }, 404);
  } else {
    const current = await verifySiteCookie(request.cookies.get(SITE_COOKIE)?.value);
    if (current && current.org === organization) site = await getSiteForOrganization(current.site, organization);
  }

  const ttl = Math.max(1, claims.exp - Math.floor(Date.now() / 1000));
  const sessionToken = await signSession({ sub: claims.sub, email: me.email, name: displayName(me), org: organization, perms }, ttl);
  const session = (await verifySession(sessionToken))!;

  const wantsJson = request.headers.get('accept')?.includes('application/json') ?? false;
  // A relative Location keeps the redirect on whatever origin served the request (nginx in front).
  const response = wantsJson
    ? noCache({ data: sessionView(session, site) })
    : new NextResponse(null, { status: 303, headers: { Location: '/ycode' } });
  response.cookies.set({ name: SESSION_COOKIE, value: sessionToken, path: '/', httpOnly: true, sameSite: 'lax', maxAge: ttl });
  if (site) {
    const value = await signSiteCookie({ site: site.id, org: organization }, ttl);
    response.cookies.set({ name: SITE_COOKIE, value, path: '/', httpOnly: true, sameSite: 'lax', maxAge: ttl });
  }
  return response;
}
