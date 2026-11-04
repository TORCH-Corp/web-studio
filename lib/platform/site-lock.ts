/**
 * One editor at a time per site (part 1, session 6; PRD V1.0 "Sites").
 *
 * `platform_site_locks` has one row per site somebody has open. The lock is the
 * user's, not the tab's: the same user opening the site twice holds it twice.
 * A lock whose heartbeat is older than LOCK_TTL_MINUTES is free, so a closed
 * laptop or a crashed webview never keeps a site shut. Every statement uses the
 * database clock, so servers and test clocks cannot disagree about "15 minutes".
 *
 * `acquireSiteLock` is the one write: it takes the lock when it is free or the
 * caller's and refreshes the heartbeat, in a single upsert, so two users
 * opening a free site at the same moment cannot both win. It serves the open
 * route, the builder's heartbeat and the proxy's check on every write.
 */

import { getKnexClient } from '@/lib/knex-client';

/** A lock whose last heartbeat is older than this is free. */
export const LOCK_TTL_MINUTES = 15;
/** How often an open builder refreshes its lock. */
export const HEARTBEAT_INTERVAL_MS = 60_000;

export interface LockHolder {
  user_id: string;
  name: string;
  /** When this user took the lock (kept across heartbeats and re-opens while it never lapsed). */
  since: string;
  heartbeat_at: string;
}

/** What a caller learns about a site's lock: whether it is theirs, and whose it is. */
export interface SiteLockState {
  held: boolean;
  holder: LockHolder | null;
}

interface LockRow {
  user_id: string;
  user_name: string;
  acquired_at: Date | string;
  heartbeat_at: Date | string;
}

const iso = (value: Date | string) => new Date(value).toISOString();

function holderFrom(row: LockRow): LockHolder {
  return { user_id: row.user_id, name: row.user_name, since: iso(row.acquired_at), heartbeat_at: iso(row.heartbeat_at) };
}

/** The site's current editor, or null when nobody holds it (no row, or a heartbeat older than the TTL). */
export async function getSiteLock(siteId: string): Promise<LockHolder | null> {
  const knex = await getKnexClient();
  const row = (await knex('platform_site_locks')
    .where({ site_id: siteId })
    .whereRaw('heartbeat_at >= now() - make_interval(mins => ?)', [LOCK_TTL_MINUTES])
    .first()) as LockRow | undefined;
  return row ? holderFrom(row) : null;
}

/**
 * Take the lock if it is free or the user's, and refresh its heartbeat.
 * `held` is false when another user holds it; `holder` is then that user.
 */
export async function acquireSiteLock(siteId: string, user: { id: string; name: string }): Promise<SiteLockState> {
  const knex = await getKnexClient();
  // A second pass covers the lock being released between the refused upsert and the read.
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await knex.raw(
      `INSERT INTO platform_site_locks AS l (site_id, user_id, user_name, acquired_at, heartbeat_at)
       VALUES (?, ?, ?, now(), now())
       ON CONFLICT (site_id) DO UPDATE SET
         acquired_at = CASE
           WHEN l.user_id = EXCLUDED.user_id AND l.heartbeat_at >= now() - make_interval(mins => ?) THEN l.acquired_at
           ELSE EXCLUDED.acquired_at
         END,
         user_id = EXCLUDED.user_id,
         user_name = EXCLUDED.user_name,
         heartbeat_at = now()
       WHERE l.user_id = EXCLUDED.user_id OR l.heartbeat_at < now() - make_interval(mins => ?)
       RETURNING l.user_id, l.user_name, l.acquired_at, l.heartbeat_at`,
      [siteId, user.id, user.name, LOCK_TTL_MINUTES, LOCK_TTL_MINUTES],
    );
    const taken = result.rows[0] as LockRow | undefined;
    if (taken) return { held: true, holder: holderFrom(taken) };
    const holder = await getSiteLock(siteId);
    if (holder) return { held: false, holder };
  }
  return { held: false, holder: null };
}

/** Let go of the lock if it is this user's. Never touches another user's lock. Returns whether a lock was released. */
export async function releaseSiteLock(siteId: string, userId: string): Promise<boolean> {
  const knex = await getKnexClient();
  const deleted = await knex('platform_site_locks').where({ site_id: siteId, user_id: userId }).del();
  return deleted > 0;
}
