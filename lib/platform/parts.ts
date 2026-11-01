/**
 * What part 1 of Web Studio ships (part 1, session 3).
 *
 * Collections and Forms belong to parts 3 and 2/3; they are built but hidden
 * until the server flag WS_PARTS=1 is set. The screens ycode no longer needs
 * (users, invitations, profile, the Supabase setup, accept-invite) answer 404
 * whatever the flag says: users, roles and profiles live in Business OS.
 */

/** Builder screens that are gone. */
const REMOVED_ROUTES = [
  '/ycode/settings/users',
  '/ycode/profile',
  '/ycode/accept-invite',
  '/ycode/welcome',
];

/** Builder screens behind WS_PARTS=1. */
const PART_ROUTES = ['/ycode/collections', '/ycode/forms'];

/** Page elements behind WS_PARTS=1 (keys of lib/templates). */
export const PART_ELEMENTS = ['form'];

/** True when WS_PARTS=1: Collections and Forms are shown. Server-side only. */
export function partsRaised(env: Record<string, string | undefined> = process.env): boolean {
  return env.WS_PARTS === '1';
}

function matches(pathname: string, route: string): boolean {
  return pathname === route || pathname.startsWith(`${route}/`);
}

/** True when the builder page at this path must answer 404. */
export function isHiddenBuilderRoute(pathname: string, parts: boolean): boolean {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  return REMOVED_ROUTES.some((route) => matches(path, route))
    || (!parts && PART_ROUTES.some((route) => matches(path, route)));
}
