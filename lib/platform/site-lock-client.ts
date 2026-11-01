/**
 * The builder's side of the site's editor lock (part 1, session 6).
 *
 * One editor at a time per site: the first load takes the lock (POST), a
 * heartbeat refreshes it every minute while the builder is open, and closing
 * the page or signing out lets go of it (DELETE). When another user holds it,
 * the builder is read-only: `useSiteLock()` says so with the editor's name,
 * the banner shows it, and the save and publish controls are disabled. The
 * server refuses the writes anyway (423 from the proxy); this only keeps the
 * screen honest. Read-only keeps beating, so the builder notices when the
 * editor leaves and reloads to take the lock.
 *
 * `held: null` means nothing is known yet (no session, no site open): the
 * builder behaves as it always has until the first answer.
 */

import { useSyncExternalStore } from 'react';
import { subscribeSession, sessionState } from './browser-session';

export const SITE_LOCK_ENDPOINT = '/ycode/api/platform/site-lock';
/** Same as HEARTBEAT_INTERVAL_MS in site-lock.ts, which imports the database client and so stays on the server. */
export const HEARTBEAT_EVERY_MS = 60_000;

export interface LockEditor {
  name: string;
  since: string;
}

export interface SiteLockView {
  held: boolean | null;
  /** Whose lock it is when `held` is false. */
  editor: LockEditor | null;
}

/** True once the builder knows another user holds the site. */
export const isReadOnly = (view: SiteLockView): boolean => view.held === false;

let view: SiteLockView = { held: null, editor: null };
const listeners = new Set<() => void>();

function set(next: SiteLockView): void {
  if (next.held === view.held && next.editor?.name === view.editor?.name && next.editor?.since === view.editor?.since) return;
  view = next;
  listeners.forEach((listener) => listener());
}

/** Decide the view from the answer of POST /site-lock; pure so it can be tested. */
export function viewFromAnswer(
  previous: SiteLockView,
  answer: { held: boolean; holder: { name: string; since: string } | null },
): { next: SiteLockView; reload: boolean } {
  if (answer.held) {
    // The editor left while this session was read-only: load again to see their changes.
    return { next: { held: true, editor: null }, reload: previous.held === false };
  }
  return { next: { held: false, editor: answer.holder ? { name: answer.holder.name, since: answer.holder.since } : null }, reload: false };
}

async function beat(): Promise<void> {
  let response: Response;
  try {
    response = await fetch(SITE_LOCK_ENDPOINT, { method: 'POST', credentials: 'same-origin' });
  } catch {
    return; // offline: the next beat tries again; the server decides writes
  }
  if (!response.ok) return; // 401 while the session renews, 404 with no site open: unknown
  const { data } = (await response.json()) as { data: { held: boolean; holder: { name: string; since: string } | null } };
  const { next, reload } = viewFromAnswer(view, data);
  if (reload) {
    window.location.reload();
    return;
  }
  set(next);
}

/** Let go of the lock; `keepalive` lets the request outlive the page that sent it. */
export function releaseLock(): void {
  if (view.held !== true) return;
  fetch(SITE_LOCK_ENDPOINT, { method: 'DELETE', credentials: 'same-origin', keepalive: true }).catch(() => {});
}

let stop: (() => void) | null = null;

/** Start keeping the lock: now, again when a session appears, every minute, and release when the page goes. Returns the stop function. */
export function startKeepingLock(): () => void {
  if (stop) return stop;
  void beat();
  const timer = setInterval(() => void beat(), HEARTBEAT_EVERY_MS);
  const unsubscribe = subscribeSession((state) => {
    if (state.view && !state.lost) void beat();
  });
  if (sessionState().view) void beat();
  // `pagehide`, not `beforeunload`: beforeunload also fires when the user cancels leaving a page with
  // unsaved changes, which would drop the lock of a builder that stays open.
  const onPageHide = () => releaseLock();
  window.addEventListener('pagehide', onPageHide);
  stop = () => {
    clearInterval(timer);
    unsubscribe();
    window.removeEventListener('pagehide', onPageHide);
    stop = null;
  };
  return stop;
}

export function useSiteLock(): SiteLockView {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => view,
    () => view,
  );
}
