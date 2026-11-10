/**
 * The public name of the builder's tree (owner, 10 Nov 2026).
 *
 * The fork keeps ycode's `/ycode` folders, so upstream still merges. What a
 * published page writes into its HTML, and what its scripts call, uses
 * `/studio` instead: the proxy maps `/studio/api/…` and `/studio/layouts/…`
 * onto `/ycode/api/…` and `/ycode/layouts/…` and runs the same session and
 * permission checks on the mapped path. The old paths keep answering, for
 * pages published before the change and for the Tauri app.
 *
 * Kept free of Next and React imports so it runs under `node --test`.
 */

/** The public prefix. */
export const PUBLIC_PREFIX = '/studio';

/** The tree it stands for. */
export const INTERNAL_PREFIX = '/ycode';

/** The sub-trees the public prefix serves: the APIs and the layouts' static assets. Builder screens are not aliased. */
const ALIASED_SUBTREES = ['/api/', '/layouts/'] as const;

/**
 * The internal path a public path stands for (`/studio/api/x` → `/ycode/api/x`),
 * or null when the path is not under an aliased sub-tree.
 */
export function internalPathOf(pathname: string): string | null {
  if (!pathname.startsWith(`${PUBLIC_PREFIX}/`)) return null;
  const rest = pathname.slice(PUBLIC_PREFIX.length);
  return ALIASED_SUBTREES.some((tree) => rest.startsWith(tree)) ? `${INTERNAL_PREFIX}${rest}` : null;
}

/** Whether a path is under the public prefix at all (`/studio`, `/studio/…`): never a site's page. */
export function isUnderPublicPrefix(pathname: string): boolean {
  return pathname === PUBLIC_PREFIX || pathname.startsWith(`${PUBLIC_PREFIX}/`);
}
