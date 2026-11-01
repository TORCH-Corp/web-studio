/**
 * The builder's half of the token bridge with the app that embeds it (part 1,
 * session 2; rule embedded-apps.md).
 *
 * The Web Studio session is a cookie minted from the shell's access token, and
 * the token lives 15 minutes. The shell (the Tauri app, session 9) always holds
 * a fresh token: Business OS pushes one to every child app every minute. So the
 * builder never signs anyone in; it asks the shell for a token and exchanges it
 * at GET /ycode/api/auth/callback for a new cookie, the way every other child
 * app asks its own `/api/auth` (products-services, Document Center).
 *
 *   builder -> shell   { type: 'torch:request-token' }
 *   shell -> builder   { type: 'torch:set-token', token, expiresAt?, site? }
 *
 * The names follow the shell's other pairs (torch:request-theme and
 * torch:set-theme). The shell may also push a token without being asked; the
 * latest push is kept for the next renewal. Messages are accepted from
 * `window.parent` only; unframed, `window.parent === window`, so a Tauri
 * webview that evaluates `window.postMessage(...)` in the page is heard too.
 *
 * Three moments:
 *   - initial: the page loads with no session; the builder shows its own
 *     "Checking authentication" screen while this module gets one;
 *   - renewal: a minute before the cookie runs out, quietly;
 *   - lost: a builder request got 401 (the laptop slept); the request waits
 *     for the new cookie and is sent again, under a "Reconnecting" notice.
 * There is no deadline and no login page, ever: a dead token is not a sign-out.
 */

import { unverifiedClaims } from './access-token';
import type { SessionView } from './session-view';

export const REQUEST_TOKEN_MESSAGE = 'torch:request-token';
export const SET_TOKEN_MESSAGE = 'torch:set-token';
export const SESSION_ENDPOINT = '/ycode/api/auth/session';
export const CALLBACK_ENDPOINT = '/ycode/api/auth/callback';

/** How long before the cookie runs out it is renewed. */
export const RENEW_BEFORE_EXPIRY_MS = 60_000;
/** While waiting for the shell's answer, how often the request is repeated. */
export const ASK_AGAIN_MS = 10_000;
/** After the server refused a token, how long before the shell is asked for another. */
export const RETRY_AFTER_REFUSAL_MS = 2_000;
/** A pushed token with less than this left is not worth exchanging. */
const MIN_TOKEN_LIFE_MS = 30_000;

export interface SetTokenMessage {
  type: typeof SET_TOKEN_MESSAGE;
  token: string;
  /** Unix seconds, as the shell's AuthToken carries it; read from the token when absent. */
  expiresAt?: number | null;
  /** The site the shell opened; keeps the builder on it after a full expiry. */
  site?: string | null;
}

export interface SessionState {
  /** The session died under the user and is being renewed: show the notice. */
  lost: boolean;
  view: SessionView | null;
}

type Listener = (state: SessionState) => void;

export function isEmbedded(): boolean {
  return typeof window !== 'undefined' && window.parent !== window;
}

let latestToken: { token: string; exp: number | null } | null = null;
let currentSite: string | null = null;
let lastView: SessionView | null = null;
let lost = false;
let renewTimer: ReturnType<typeof setTimeout> | null = null;
let recovering: Promise<SessionView | null> | null = null;
const listeners = new Set<Listener>();
const tokenWaiters = new Set<(token: string) => void>();

export function sessionState(): SessionState {
  return { lost, view: lastView };
}

export function subscribeSession(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify(): void {
  const state = sessionState();
  listeners.forEach((listener) => listener(state));
}

function onMessage(event: MessageEvent): void {
  if (event.source !== window.parent) return;
  const data = event.data as Partial<SetTokenMessage> | null;
  if (!data || data.type !== SET_TOKEN_MESSAGE || typeof data.token !== 'string' || !data.token) return;
  const exp = typeof data.expiresAt === 'number' ? data.expiresAt : unverifiedClaims(data.token)?.exp ?? null;
  latestToken = { token: data.token, exp };
  if (typeof data.site === 'string' && data.site) currentSite = data.site;
  const waiters = [...tokenWaiters];
  tokenWaiters.clear();
  waiters.forEach((waiter) => waiter(data.token as string));
}

if (typeof window !== 'undefined') {
  window.addEventListener('message', onMessage);
}

/** The token the shell last pushed, if it still has life in it. */
function freshToken(): string | null {
  if (!latestToken) return null;
  if (latestToken.exp !== null && latestToken.exp * 1000 - Date.now() < MIN_TOKEN_LIFE_MS) return null;
  return latestToken.token;
}

/** A token from the shell: the last fresh push, or ask and wait, asking again every ASK_AGAIN_MS. No deadline. */
export function requestToken(): Promise<string> {
  const fresh = freshToken();
  if (fresh) return Promise.resolve(fresh);
  return new Promise((resolve) => {
    const ask = () => window.parent.postMessage({ type: REQUEST_TOKEN_MESSAGE }, '*');
    const timer = setInterval(ask, ASK_AGAIN_MS);
    tokenWaiters.add((token) => {
      clearInterval(timer);
      resolve(token);
    });
    ask();
  });
}

export type ExchangeResult = { ok: true; view: SessionView } | { ok: false; status: number | null };

/** Exchange the shell's token for Web Studio's cookie; the response sets it. */
export async function exchangeToken(token: string, site: string | null): Promise<ExchangeResult> {
  const params = new URLSearchParams({ token });
  if (site) params.set('site', site);
  let response: Response;
  try {
    response = await fetch(`${CALLBACK_ENDPOINT}?${params}`, { headers: { Accept: 'application/json' }, cache: 'no-store', credentials: 'same-origin' });
  } catch (error) {
    console.warn('[web-studio session] the callback could not be reached', error);
    return { ok: false, status: null };
  }
  if (!response.ok) {
    console.warn(`[web-studio session] the callback refused the shell's token with ${response.status}`);
    return { ok: false, status: response.status };
  }
  const body = (await response.json()) as { data?: SessionView };
  if (!body.data?.user) return { ok: false, status: response.status };
  return { ok: true, view: body.data };
}

/** Remember what the server said about the session, and renew it before it runs out. */
export function rememberSession(view: SessionView | null): void {
  if (!view) return;
  lastView = view;
  if (view.site) currentSite = view.site.id;
  if (!isEmbedded()) return;
  if (renewTimer) clearTimeout(renewTimer);
  const delay = Math.max(1_000, view.expiresAt * 1000 - Date.now() - RENEW_BEFORE_EXPIRY_MS);
  renewTimer = setTimeout(() => {
    void recoverSession('renewal');
  }, delay);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * A refused token can be replaced by a fresher one (401: stale) or not at all
 * (403: no permission, 404: not this organization's site, 400, 500): only the
 * first is worth another round with the shell. An unreachable server or a 502
 * is a wait, so it is tried again too.
 */
function worthAnotherToken(status: number | null): boolean {
  return status === null || status === 401 || status >= 500;
}

/**
 * Get a session: a token from the shell, exchanged for the cookie, and the
 * listeners told. One recovery at a time; a burst of 401s shares it.
 *
 *   'initial'  no session when the page loaded: keep trying, quietly (the
 *              builder shows its own "Checking authentication" screen)
 *   'renewal'  before expiry: one try, quietly; a failure leaves the 401 path
 *              to pick it up
 *   'lost'     a request was refused: keep trying under the notice
 *
 * Null only when the server's refusal cannot be cured by a new token, or on a
 * failed renewal.
 */
export function recoverSession(reason: 'initial' | 'renewal' | 'lost'): Promise<SessionView | null> {
  if (recovering) return recovering;
  if (reason === 'lost' && !lost) {
    lost = true;
    notify();
  }
  recovering = (async () => {
    for (;;) {
      const token = await requestToken();
      const result = await exchangeToken(token, currentSite);
      if (result.ok) {
        lost = false;
        rememberSession(result.view);
        notify();
        return result.view;
      }
      latestToken = null; // never exchange a refused token twice
      if (reason === 'renewal' || !worthAnotherToken(result.status)) return null;
      await sleep(RETRY_AFTER_REFUSAL_MS);
    }
  })().finally(() => {
    recovering = null;
  });
  return recovering;
}

function requestPath(input: RequestInfo | URL): string | null {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (url.startsWith('/')) return url.split('?')[0];
  try {
    const parsed = new URL(url);
    return parsed.origin === window.location.origin ? parsed.pathname : null;
  } catch {
    return null;
  }
}

/** A builder API request this module may send again after renewing the session. */
export function guardsRequest(input: RequestInfo | URL, init?: RequestInit): boolean {
  const path = requestPath(input);
  if (!path || !path.startsWith('/ycode/api/') || path.startsWith('/ycode/api/auth/')) return false;
  // A streamed body was consumed by the first attempt and cannot be sent again.
  if (init?.body && typeof ReadableStream !== 'undefined' && init.body instanceof ReadableStream) return false;
  if (typeof Request !== 'undefined' && input instanceof Request && input.bodyUsed) return false;
  return true;
}

/**
 * Wrap `fetch`: a 401 from the builder's API while embedded means the cookie
 * died. The session is recovered and the request sent once more. Installed
 * once, by lib/supabase-browser.ts, for every request ycode makes.
 */
export function installSessionGuard(): void {
  if (typeof window === 'undefined') return;
  const scope = window as Window & { __webStudioSessionGuard?: boolean };
  if (scope.__webStudioSessionGuard) return;
  scope.__webStudioSessionGuard = true;
  const original = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const response = await original(input, init);
    if (response.status !== 401 || !isEmbedded() || !guardsRequest(input, init)) return response;
    const view = await recoverSession('lost');
    if (!view) return response;
    return original(input, init);
  };
}
