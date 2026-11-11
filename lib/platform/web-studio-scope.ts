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
 * The scope itself is data, `permission-scope.json`: five leaves in four
 * modules with the flag defaults the PRDs give the Manager, Member and Viewer
 * profiles. Manager: every flag on every leaf. Member: manage_content c r u,
 * r on the others. Viewer: r on every leaf. Part 2 (PRD V1.1) gave Member and
 * Viewer r on manage_orders: x, confirm and cancel, stays with the Manager.
 * Part 3 (PRD V1.0 "Roles and permissions", session W1) moves collections
 * under manage_content, leaves a form's submissions on manage_forms, adds
 * manage_reports, and gives Member and Viewer r on both. The scope is
 * published again at every start, but a profile that already exists is not
 * rewritten: its grants stay as an administrator set them.
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
  /** Pages, collections, layers, styles, components, assets, locales, translations, publish, static export, the AI agent. */
  manageContent: 'webstudio.manage_content',
  /** A form's submissions (part 3); webhooks, API keys and the integrations, which stay hidden. */
  manageForms: 'webstudio.manage_forms',
  /** Storefront orders (part 2). */
  manageOrders: 'webstudio.manage_orders',
  /** The Traffic and Conversions reports and the Dashboard's visit numbers (part 3). */
  manageReports: 'webstudio.manage_reports',
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
