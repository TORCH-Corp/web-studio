/**
 * Browser client (c0 port).
 *
 * The builder used supabase-js in the browser for three things: reading the
 * session, realtime collaboration channels, and sign-out. The session now
 * comes from `/ycode/api/auth/session` (the Business OS cookie); channels are
 * accepted and do nothing (collaboration is off in c0); sign-out clears the
 * cookie. No database or storage calls ever happened from the browser.
 */

import type { RealtimeChannel, Session, SupabaseClient, User } from '@supabase/supabase-js';

type Listener = (event: string, session: Session | null) => void;

interface SessionResponse {
  data?: { session: Session | null; user: User | null };
}

let cached: Session | null | undefined;
let inflight: Promise<Session | null> | null = null;
const listeners = new Set<Listener>();

async function fetchSession(): Promise<Session | null> {
  if (cached !== undefined) return cached;
  if (!inflight) {
    inflight = fetch('/ycode/api/auth/session', { cache: 'no-store' })
      .then(async (r) => (r.ok ? ((await r.json()) as SessionResponse).data?.session ?? null : null))
      .catch(() => null)
      .then((s) => { cached = s; inflight = null; return s; });
  }
  return inflight;
}

function noopChannel(topic: string): RealtimeChannel {
  const channel = {
    on: (..._args: unknown[]) => channel,
    subscribe: (cb?: (status: string) => void) => { cb?.('SUBSCRIBED'); return channel; },
    send: async (..._args: unknown[]) => 'ok' as const,
    track: async (..._args: unknown[]) => 'ok' as const,
    untrack: async (..._args: unknown[]) => 'ok' as const,
    unsubscribe: async (..._args: unknown[]) => 'ok' as const,
    presenceState: () => ({}),
    topic,
    state: 'joined',
  };
  return channel as unknown as RealtimeChannel;
}

const client = {
  auth: {
    async getSession() { return { data: { session: await fetchSession() }, error: null }; },
    async getUser() { const s = await fetchSession(); return { data: { user: s?.user ?? null }, error: null }; },
    async refreshSession() { cached = undefined; return { data: { session: await fetchSession() }, error: null }; },
    async setSession(_session: unknown) { return { data: { session: null, user: null }, error: { message: 'Sign in through Business OS' } }; },
    async signInWithPassword(_credentials?: unknown) { return { data: { session: null, user: null }, error: { message: 'Sign in through Business OS' } }; },
    async signUp(_credentials?: unknown) { return { data: { session: null, user: null }, error: { message: 'Users are created in Business OS' } }; },
    async signOut() {
      await fetch('/ycode/api/auth/logout', { method: 'POST' }).catch(() => undefined);
      cached = null;
      listeners.forEach((l) => l('SIGNED_OUT', null));
      return { error: null };
    },
    async updateUser(_attributes?: unknown) { return { data: { user: null }, error: { message: 'Your profile is managed in Business OS' } }; },
    onAuthStateChange(cb: Listener) {
      listeners.add(cb);
      return { data: { subscription: { unsubscribe: () => listeners.delete(cb) } } };
    },
  },
  channel: (topic: string, _opts?: unknown) => noopChannel(topic),
  removeChannel: async (_channel?: RealtimeChannel) => 'ok' as const,
  removeAllChannels: async () => [] as 'ok'[],
  getChannels: () => [] as RealtimeChannel[],
};

export function resetBrowserClient(): void {
  cached = undefined;
}

/** Typed as SupabaseClient so the hooks compile unchanged; only the members above exist. */
export async function createBrowserClient(): Promise<SupabaseClient> {
  return client as unknown as SupabaseClient;
}

export async function createClient(): Promise<SupabaseClient> {
  return client as unknown as SupabaseClient;
}
