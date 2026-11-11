/**
 * What the builder shows and what it hides (part 1, session 3; part 3, session W2).
 *
 * Collections and Forms are shown for every site, with no flag (part 3, PRD V1.0
 * "Forms" and "Collections"). What stays hidden, whatever the user's permission
 * flags, is what the PRD's Out-of-Scope lists: ycode's webhooks, API keys and
 * integrations. The screens ycode no longer needs (users, invitations, profile,
 * the Supabase setup, accept-invite) answer 404 as well: users, roles and
 * profiles live in Business OS.
 *
 * Hidden here means the proxy answers 404 before it looks at the session, so no
 * flag opens them (`proxy.ts`), and the builder does not draw the way in
 * (the Integrations menu, the Apps list). What stays under Integrations is the
 * static export, the map keys and MCP.
 */

/** Builder screens that are gone. */
const REMOVED_ROUTES = [
  '/ycode/settings/users',
  '/ycode/profile',
  '/ycode/accept-invite',
  '/ycode/welcome',
];

/** Builder screens that stay hidden for everyone: the webhooks and the API keys screens ("Web Studio API"). */
const HIDDEN_ROUTES = [
  '/ycode/integrations/webhooks',
  '/ycode/integrations/api',
];

/**
 * The apps of ycode's Apps screen that stay hidden: the connectors that send a form's submissions or a
 * collection's rows to another service (Airtable, MailerLite, Webflow) and the three placeholders that
 * were never built. What stays: Static HTML Export, Mapbox and Google Map.
 */
export const HIDDEN_APP_IDS: readonly string[] = ['airtable', 'webflow', 'mailerlite', 'mailchimp', 'zapier', 'make'];

/**
 * API paths that answer 404 for everyone: the webhooks, the API keys and each hidden app's routes. The
 * public API under `/ycode/api/v1` is not here: it only answers a request that carries an API key, and
 * no key can be made.
 */
const HIDDEN_API_ROUTES = [
  '/ycode/api/webhooks',
  '/ycode/api/api-keys',
  ...HIDDEN_APP_IDS.map((id) => `/ycode/api/apps/${id}`),
];

function matches(pathname: string, route: string): boolean {
  return pathname === route || pathname.startsWith(`${route}/`);
}

/** True when the builder page or API route at this path must answer 404, whoever asks. */
export function isHiddenBuilderRoute(pathname: string): boolean {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  return [...REMOVED_ROUTES, ...HIDDEN_ROUTES, ...HIDDEN_API_ROUTES].some((route) => matches(path, route));
}

/** True when the app of this id must not be listed or opened. */
export function isHiddenApp(appId: string): boolean {
  return HIDDEN_APP_IDS.includes(appId);
}
