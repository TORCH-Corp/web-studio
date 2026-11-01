/**
 * The `webstudio` permission scope (part 1, session 2).
 *
 * A permission is a LEAF plus a FLAG, looked up by auth-service as an exact
 * pair, `profile.permissions[leafKey][flag]`. The leaf names an area of the
 * app, the flag names the action, and the flags are exactly
 * `c r u d x export use_ai`: static export is `export` on manage_content,
 * the AI agent is `use_ai` on it. Leaf keys are a permanent contract: renaming
 * one silently revokes every grant of the old name. Add leaves; never rename.
 *
 * The scope itself is data, `permission-scope.json`: four leaves in three
 * modules with the flag defaults PRD V1.0 gives the Manager, Member and Viewer
 * profiles (Manager every flag, Member manage_content c r u and manage_sites r,
 * Viewer r on both, nothing on forms and orders). Part 1 enforces the first two
 * leaves; manage_forms and manage_orders are declared now for parts 2 and 3.
 *
 * `buildWebStudioScope` adds the catalogue app id and gives the shape
 * auth-service's consumer expects (PermissionScopeShape); scope-registration.ts
 * publishes it.
 */

import type { Flag, WebStudioLeaf } from './session';
import scope from './permission-scope.json';

export const WEB_STUDIO_APP_NAME = 'Web Studio';

export const WEB_STUDIO_LEAF = {
  /** Sites: create and delete a site, its settings and domain, the list. */
  manageSites: 'webstudio.manage_sites',
  /** Pages, layers, styles, components, assets, locales, translations, publish, static export, the AI agent. */
  manageContent: 'webstudio.manage_content',
  /** The contact form, its submissions, collections, webhooks and the integrations (part 3). */
  manageForms: 'webstudio.manage_forms',
  /** Storefront orders (part 2). */
  manageOrders: 'webstudio.manage_orders',
} as const satisfies Record<string, WebStudioLeaf>;

export const WEB_STUDIO_LEAVES: readonly WebStudioLeaf[] = Object.values(WEB_STUDIO_LEAF);

export const FLAGS: readonly Flag[] = ['c', 'r', 'u', 'd', 'x', 'export', 'use_ai'];

export type PermissionFlags = Record<Flag, boolean>;

export interface ScopeLeaf {
  id: string;
  name: string;
  leaf_key: string;
  system_role_defaults: { manager: PermissionFlags; member: PermissionFlags; viewer: PermissionFlags };
}

export interface ScopeSubModule {
  id: string;
  name: string;
  entities: ScopeLeaf[];
}

export interface ScopeModule {
  id: string;
  name: string;
  sub_modules: ScopeSubModule[];
}

/** auth-service's PermissionScopeShape. */
export interface PermissionScope {
  app_id: string;
  app_name: string;
  version: string;
  modules: ScopeModule[];
}

export function buildWebStudioScope(appId: string): PermissionScope {
  return { app_id: appId, ...(scope as Omit<PermissionScope, 'app_id'>) };
}

export function scopeLeaves(s: Omit<PermissionScope, 'app_id'>): ScopeLeaf[] {
  return s.modules.flatMap((module) => module.sub_modules.flatMap((subModule) => subModule.entities));
}
