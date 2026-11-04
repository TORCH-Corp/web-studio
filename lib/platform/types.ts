/**
 * Types the builder's code used to import from the Supabase client package.
 *
 * Only the shapes ycode reads are described. The runtime behind them is the
 * platform's own: `pg-client.ts` on the server, `supabase-browser.ts` in the
 * browser (session from the Business OS cookie, realtime channels that do
 * nothing while collaboration is off).
 */

import type { PgResult, QueryBuilder } from '@/lib/platform/pg-client';

export interface User {
  id: string;
  email?: string;
  aud: string;
  role?: string;
  app_metadata: Record<string, any>;
  user_metadata: Record<string, any>;
  created_at: string;
  updated_at?: string;
}

export interface Session {
  access_token: string;
  refresh_token?: string;
  expires_at?: number;
  user: User;
}

export const REALTIME_SUBSCRIBE_STATES = {
  SUBSCRIBED: 'SUBSCRIBED',
  TIMED_OUT: 'TIMED_OUT',
  CLOSED: 'CLOSED',
  CHANNEL_ERROR: 'CHANNEL_ERROR',
} as const;

export interface RealtimeChannel {
  topic: string;
  state: string;
  on(type: string, filter: unknown, callback: (payload: any) => void): RealtimeChannel;
  subscribe(callback?: (status: string, error?: Error) => void): RealtimeChannel;
  send(message: unknown): Promise<string>;
  track(payload: unknown): Promise<string>;
  untrack(): Promise<string>;
  unsubscribe(): Promise<string>;
  presenceState(): Record<string, any[]>;
}

/**
 * The client the repositories and hooks are written against: database,
 * storage, channels, session. Query results are untyped, as they were with
 * supabase-js without generated database types; the callers cast.
 */
export interface SupabaseClient {
  from(table: string): QueryBuilder<any[]>;
  rpc(name: string, args?: Record<string, unknown>): Promise<PgResult<any>>;
  storage: any;
  auth: {
    getSession(): Promise<{ data: { session: Session | null }; error: any }>;
    getUser(): Promise<{ data: { user: User | null }; error: any }>;
    refreshSession(): Promise<{ data: { session: Session | null }; error: any }>;
    setSession(session: unknown): Promise<{ data: { session: Session | null; user: User | null }; error: any }>;
    signInWithPassword(credentials?: unknown): Promise<{ data: { session: Session | null; user: User | null }; error: any }>;
    signUp(credentials?: unknown): Promise<{ data: { session: Session | null; user: User | null }; error: any }>;
    signOut(): Promise<{ error: any }>;
    updateUser(attributes?: unknown): Promise<{ data: { user: User | null }; error: any }>;
    onAuthStateChange(callback: (event: string, session: Session | null) => void): { data: { subscription: { unsubscribe(): void } } };
    admin?: any;
  };
  channel(name: string, options?: unknown): RealtimeChannel;
  removeChannel(channel?: RealtimeChannel): Promise<string>;
  removeAllChannels(): Promise<string[]>;
  getChannels?(): RealtimeChannel[];
  siteId?: string | null;
}
