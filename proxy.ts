import { SESSION_COOKIE, SITE_COOKIE, verifySession, verifySiteCookie, type BosSession } from '@/lib/platform/session';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { applySecurityHeaders } from '@/lib/security-headers-server';
import { prefetchYcodePublishedAt } from '@/lib/ycode-html-comment';

/**
 * Public API routes that skip authentication.
 */
const PUBLIC_API_PREFIXES = [
  '/ycode/api/setup/',    // Setup wizard — needed before any user exists
  '/ycode/api/auth/',     // Auth callbacks and session checks
  '/ycode/api/v1/',       // Public API — has own API key auth
];

/**
 * Routes that need a session but no site: the sites API itself, which lists,
 * creates and opens sites. A stale `ws_site` cookie must not lock a user out
 * of it (part 1, session 1).
 */
const SITELESS_API_PREFIXES = ['/ycode/api/platform/'];

/**
 * Patterns for collection item endpoints that must be accessible on published pages
 * (load-more pagination, filter). Matched via regex since the collection ID is dynamic.
 */
const PUBLIC_COLLECTION_ITEM_SUFFIXES = ['/items/filter', '/items/load-more'];

const PUBLIC_API_EXACT = [
  '/ycode/api/revalidate', // Cache revalidation — has own secret token auth
  '/ycode/api/oauth/register', // RFC 7591 Dynamic Client Registration — anonymous
  '/ycode/api/oauth/token',    // OAuth token exchange — auth is via PKCE/refresh
];

/** Forward the request with its pathname as a header, keeping cookies and headers already set. */
function withPathname(response: NextResponse, request: NextRequest, pathname: string): NextResponse {
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-pathname', pathname);
  const next = NextResponse.next({
    request: { headers: requestHeaders },
  });
  response.cookies.getAll().forEach((cookie) => {
    next.cookies.set(cookie.name, cookie.value);
  });
  response.headers.forEach((value, key) => {
    next.headers.set(key, value);
  });
  next.headers.set('x-pathname', pathname);
  return next;
}

function isPublicApiRoute(pathname: string, method: string, searchParams: URLSearchParams): boolean {
  // POST to form-submissions is public (website visitors submitting forms)
  if (pathname === '/ycode/api/form-submissions' && method === 'POST') {
    return true;
  }

  // Published error pages are rendered for visitors by the error boundary, so the
  // published variant must be readable anonymously. Drafts stay behind auth.
  if (method === 'GET' && pathname === '/ycode/api/error-page'
      && searchParams.get('published') === 'true') {
    return true;
  }

  if (PUBLIC_API_EXACT.includes(pathname)) return true;

  if (PUBLIC_API_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return true;

  // Collection item endpoints for published pages (POST only — filter, load-more)
  if (method === 'POST' && pathname.startsWith('/ycode/api/collections/') &&
      PUBLIC_COLLECTION_ITEM_SUFFIXES.some(suffix => pathname.endsWith(suffix))) {
    return true;
  }

  return false;
}

/**
 * Verify the Business OS session for protected API routes.
 * Returns a 401 response if not authenticated, or null to continue.
 */
async function verifyApiAuth(request: NextRequest): Promise<NextResponse | null> {
  if (isPublicApiRoute(request.nextUrl.pathname, request.method, request.nextUrl.searchParams)) {
    return null;
  }

  // c0 port: the builder's API is open to a Business OS session only.
  const session = await verifySession(request.cookies.get(SESSION_COOKIE)?.value);
  if (!session) {
    return NextResponse.json(
      { error: 'Not authenticated' },
      { status: 401 }
    );
  }

  if (!SITELESS_API_PREFIXES.some((prefix) => request.nextUrl.pathname.startsWith(prefix))) {
    const refused = await refuseForeignSiteCookie(request, session);
    if (refused) return refused;
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

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // MCP endpoints use their own token-based authentication — skip session auth.
  // Cloud overlay proxies MUST also exempt these paths to avoid login redirects.
  //   - `/ycode/mcp/<token>`: legacy URL-token endpoint (Cursor, Windsurf, etc.)
  //   - `/ycode/mcp`: OAuth Bearer-token endpoint (Claude.ai web, ChatGPT)
  if (pathname === '/ycode/mcp' || pathname.startsWith('/ycode/mcp/')) {
    return withPathname(NextResponse.next(), request, pathname);
  }

  // Debug escape hatch: skip auth on preview routes when explicitly enabled.
  const skipPreviewAuth = process.env.DISABLE_PREVIEW_AUTH === 'true'
    && pathname.startsWith('/ycode/preview');

  // Protect API and preview routes with auth. `/api/templates` lives outside the
  // `/ycode` tree (public site route group) but exposes destructive builder-only
  // operations (apply/export), so it must be gated here too.
  if (!skipPreviewAuth && (pathname.startsWith('/ycode/api') || pathname.startsWith('/ycode/preview') || pathname.startsWith('/api/templates'))) {
    const authResponse = await verifyApiAuth(request);
    if (authResponse) {
      if (authResponse.status === 401) {
        if (pathname.startsWith('/ycode/preview')) {
          return NextResponse.redirect(new URL('/ycode', request.url));
        }
        return authResponse;
      }
      if (authResponse.status === 404) {
        return authResponse;
      }
      // Authenticated — pass through
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
