import { SESSION_COOKIE, SITE_COOKIE, hasFlag, verifySession, verifySiteCookie, type BosSession } from '@/lib/platform/session';
import { accessFor, isEditingWrite, requirementName } from '@/lib/platform/permissions';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { applySecurityHeaders } from '@/lib/security-headers-server';
import { isHiddenBuilderRoute } from '@/lib/platform/parts';
import { acquireSiteLock } from '@/lib/platform/site-lock';
import { prefetchYcodePublishedAt } from '@/lib/ycode-html-comment';
import { internalPathOf, isUnderPublicPrefix } from '@/lib/platform/public-path';

/**
 * Routes that need a session but no site: the sites API, which lists, creates
 * and opens sites, and the session routes. A stale `ws_site` cookie must not
 * lock a user out of them (part 1, session 1).
 */
const SITELESS_API_PREFIXES = ['/ycode/api/platform/', '/ycode/api/auth/'];

/**
 * Forward the request with its pathname as a header, keeping cookies and headers already set.
 * A request that came by the public prefix (`/studio/…`, lib/platform/public-path.ts) is
 * forwarded to the path it stands for.
 */
function withPathname(response: NextResponse, request: NextRequest, pathname: string): NextResponse {
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-pathname', pathname);
  let next: NextResponse;
  if (pathname !== request.nextUrl.pathname) {
    const target = request.nextUrl.clone();
    target.pathname = pathname;
    next = NextResponse.rewrite(target, { request: { headers: requestHeaders } });
  } else {
    next = NextResponse.next({
      request: { headers: requestHeaders },
    });
  }
  response.cookies.getAll().forEach((cookie) => {
    next.cookies.set(cookie.name, cookie.value);
  });
  response.headers.forEach((value, key) => {
    next.headers.set(key, value);
  });
  next.headers.set('x-pathname', pathname);
  return next;
}

/**
 * The session and the permission a builder request needs (part 1, session 2).
 *
 * lib/platform/permissions.ts names the leaf and flag of every route under
 * /ycode/api (and of the preview and the templates bridge). A public route
 * passes; any other needs the Business OS session (401 without one), the flag
 * the route names (403 without it, naming the `leaf.flag` an administrator
 * ticks), and, unless it is one of the siteless routes, a `ws_site` cookie of
 * the session's organization. A path the map does not know is not found.
 * Returns null to continue.
 */
async function verifyApiAuth(request: NextRequest, pathname: string): Promise<NextResponse | null> {
  const { searchParams } = request.nextUrl;
  const access = accessFor(pathname, request.method, searchParams);
  if (!access || access.kind === 'public') return null;

  // A path under /ycode/api that no route names: not found, whoever asks. A
  // route file without a rule cannot reach here (permissions.test.ts fails on it).
  if (access.kind === 'unmapped') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const session = await verifySession(request.cookies.get(SESSION_COOKIE)?.value);
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  if (access.kind === 'leaf' && !hasFlag(session, access.leaf, access.flag)) {
    return NextResponse.json({ error: 'Forbidden', required: requirementName(access) }, { status: 403 });
  }

  if (!SITELESS_API_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    const refused = await refuseForeignSiteCookie(request, session);
    if (refused) return refused;
    if (isEditingWrite(access, request.method)) {
      const locked = await refuseWriteWithoutLock(request, session);
      if (locked) return locked;
    }
  }

  return NextResponse.next({ request });
}

/**
 * Part 1, session 1: the builder works on the site named by the signed
 * `ws_site` cookie. The cookie carries the organization it was checked
 * against, so a cookie that is not valid or belongs to another organization
 * is refused here, with no database lookup, and dropped from the browser.
 * lib/platform/site.ts then checks the site itself against the database.
 */
async function refuseForeignSiteCookie(request: NextRequest, session: BosSession): Promise<NextResponse | null> {
  const raw = request.cookies.get(SITE_COOKIE)?.value;
  if (!raw) return null;
  const siteCookie = await verifySiteCookie(raw);
  if (siteCookie && siteCookie.org === session.org) return null;
  const response = NextResponse.json({ error: 'Site not found' }, { status: 404 });
  response.cookies.set({ name: SITE_COOKIE, value: '', path: '/', maxAge: 0 });
  return response;
}

/**
 * Part 1, session 6: one editor at a time. A write to the open site needs the
 * site's editor lock. A free (or lapsed) lock is taken by the write, which
 * counts as activity; a lock another user holds answers 423 with that user's
 * name and nothing is written. Reads never come here. The lock service is the
 * one statement in lib/platform/site-lock.ts; a failure of it fails the write
 * (500) rather than letting two editors through.
 */
async function refuseWriteWithoutLock(request: NextRequest, session: BosSession): Promise<NextResponse | null> {
  const raw = request.cookies.get(SITE_COOKIE)?.value;
  const siteCookie = raw ? await verifySiteCookie(raw) : null;
  if (!siteCookie) return null; // no site open: nothing to lock, and the route answers as before
  try {
    const lock = await acquireSiteLock(siteCookie.site, { id: session.sub, name: session.name || session.email });
    if (lock.held) return null;
    const holder = lock.holder?.name ?? 'another editor';
    return NextResponse.json(
      { error: `${holder} is editing this site`, holder, since: lock.holder?.since ?? null },
      { status: 423 },
    );
  } catch (error) {
    console.error('[proxy] editor lock check failed', error);
    return NextResponse.json({ error: 'Could not check the site\'s editor lock' }, { status: 500 });
  }
}

export async function proxy(request: NextRequest) {
  // The public prefix: `/studio/api/…` and `/studio/layouts/…` are checked and served as the
  // `/ycode` path they stand for; nothing else lives under `/studio`.
  const aliased = internalPathOf(request.nextUrl.pathname);
  if (!aliased && isUnderPublicPrefix(request.nextUrl.pathname)) {
    return new NextResponse('Not found', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
  const pathname = aliased ?? request.nextUrl.pathname;

  // MCP endpoints use their own token-based authentication — skip session auth.
  // Cloud overlay proxies MUST also exempt these paths to avoid login redirects.
  //   - `/ycode/mcp/<token>`: legacy URL-token endpoint (Cursor, Windsurf, etc.)
  //   - `/ycode/mcp`: OAuth Bearer-token endpoint (Claude.ai web, ChatGPT)
  if (pathname === '/ycode/mcp' || pathname.startsWith('/ycode/mcp/')) {
    return withPathname(NextResponse.next(), request, pathname);
  }

  // Screens removed from the builder, and what stays hidden whatever the user's flags: the webhooks, the API keys and the
  // connector apps, screens and routes alike (part 1, session 3; part 3, session W2). Collections and Forms are shown.
  if (isHiddenBuilderRoute(pathname)) {
    return new NextResponse('Not found', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }

  // Debug escape hatch: skip auth on preview routes when explicitly enabled.
  const skipPreviewAuth = process.env.DISABLE_PREVIEW_AUTH === 'true'
    && pathname.startsWith('/ycode/preview');

  // Protect API and preview routes with auth. `/api/templates` lives outside the
  // `/ycode` tree (public site route group) but exposes destructive builder-only
  // operations (apply/export), so it must be gated here too.
  if (!skipPreviewAuth && (pathname.startsWith('/ycode/api') || pathname.startsWith('/ycode/preview') || pathname.startsWith('/api/templates'))) {
    const authResponse = await verifyApiAuth(request, pathname);
    if (authResponse) {
      if (authResponse.status >= 400) {
        // A preview with no session goes back to the builder, never to a login page.
        if (authResponse.status === 401 && pathname.startsWith('/ycode/preview')) {
          return NextResponse.redirect(new URL('/ycode', request.url));
        }
        return authResponse;
      }
      // Authenticated and permitted — pass through
      return withPathname(authResponse, request, pathname);
    }
  }

  const isPublicPage = !pathname.startsWith('/ycode')
    && !pathname.startsWith('/_next')
    && !pathname.startsWith('/api')
    && !pathname.startsWith('/dynamic');
  const hasPaginationParams = Array.from(request.nextUrl.searchParams.keys())
    .some((key) => key.startsWith('p_'));

  if (isPublicPage && hasPaginationParams) {
    const rewriteUrl = request.nextUrl.clone();
    rewriteUrl.pathname = pathname === '/' ? '/dynamic' : `/dynamic${pathname}`;

    const requestHeaders = new Headers(request.headers);
    requestHeaders.set('x-pathname', pathname);
    const rewriteResponse = NextResponse.rewrite(rewriteUrl, {
      request: { headers: requestHeaders },
    });
    rewriteResponse.headers.set('x-pathname', pathname);
    await applySecurityHeaders(rewriteResponse);
    await prefetchYcodePublishedAt();
    return rewriteResponse;
  }

  // Create response
  const response = withPathname(NextResponse.next(), request, pathname);

  // Cache-Control for public pages is configured centrally via next.config.ts headers().

  // Apply configurable security headers to public pages only (not builder/API).
  if (isPublicPage) {
    await applySecurityHeaders(response);
    await prefetchYcodePublishedAt();
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
