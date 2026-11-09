import { getRequestOrigin } from '@/lib/url-utils';

/**
 * Extract the client IP from reverse-proxy headers.
 * Returns null when no forwarding header is present (e.g. local dev).
 *
 * TORCH (part 2 release fixes, OPEN_QUESTIONS 35): ycode read the first
 * `X-Forwarded-For` entry, which is the one the visitor wrote itself: nginx
 * appends the address it saw (`$proxy_add_x_forwarded_for`), so a script that
 * sent its own header got a fresh count on every request. `X-Real-IP` is what
 * nginx sets to `$remote_addr`, a value a visitor cannot choose, so it comes
 * first; without it the last `X-Forwarded-For` entry is the nearest proxy's.
 */
export function getClientIp(headers: Headers): string | null {
  const real = headers.get('x-real-ip')?.trim();
  if (real) return real;
  const forwarded = headers.get('x-forwarded-for')?.split(',').map((entry) => entry.trim()).filter(Boolean);
  return forwarded?.at(-1) || null;
}

/**
 * Check that a request was issued by the site itself.
 *
 * Compares the Origin (or Referer) host against the request host, so it holds
 * for any domain the site is served on without configuration. Only the host is
 * compared because a reverse proxy may terminate TLS and leave the forwarded
 * protocol unset. Requests missing both headers count as cross-origin —
 * browsers always send Origin on POST.
 */
export function isSameOriginRequest(headers: Headers): boolean {
  const requestOrigin = getRequestOrigin(headers);
  const source = headers.get('origin') || headers.get('referer');

  if (!requestOrigin || !source) {
    return false;
  }

  try {
    return new URL(source).host === new URL(requestOrigin).host;
  } catch {
    return false;
  }
}
