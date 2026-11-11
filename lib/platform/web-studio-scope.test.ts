import assert from 'node:assert/strict';
import { test } from 'node:test';

import { FLAGS, WEB_STUDIO_LEAVES, buildWebStudioScope, scopeLeaves } from './web-studio-scope';

const APP_ID = 'de4944b6-b43a-4cc5-96fe-c1d38852b61d';
const scope = buildWebStudioScope(APP_ID);
const leaves = scopeLeaves(scope);
const byKey = Object.fromEntries(leaves.map((leaf) => [leaf.leaf_key, leaf]));

test('the scope declares exactly the five webstudio leaves, each once, under the app id', () => {
  assert.equal(scope.app_id, APP_ID);
  assert.equal(scope.app_name, 'Web Studio');
  assert.deepEqual(leaves.map((leaf) => leaf.leaf_key).sort(), [...WEB_STUDIO_LEAVES].sort());
  // Leaf keys are a permanent contract: the four of parts 1 and 2 keep their names, part 3 adds the fifth.
  assert.deepEqual(leaves.map((leaf) => leaf.leaf_key).sort(), [
    'webstudio.manage_content',
    'webstudio.manage_forms',
    'webstudio.manage_orders',
    'webstudio.manage_reports',
    'webstudio.manage_sites',
  ]);
  assert.deepEqual(scope.modules.map((module) => module.id), ['webstudio.sites', 'webstudio.forms', 'webstudio.store', 'webstudio.reports']);
  assert.deepEqual(scope.modules[3].sub_modules.flatMap((subModule) => subModule.entities.map((leaf) => leaf.leaf_key)), ['webstudio.manage_reports']);
  for (const leaf of leaves) {
    assert.equal(leaf.id, leaf.leaf_key);
    assert.ok(leaf.name.trim());
  }
});

test('every default names exactly the seven valid flags for the three profiles', () => {
  for (const leaf of leaves) {
    for (const role of ['manager', 'member', 'viewer'] as const) {
      const flags = leaf.system_role_defaults[role];
      assert.deepEqual(Object.keys(flags).sort(), [...FLAGS].sort(), `${leaf.leaf_key} ${role}`);
    }
  }
});

test('the defaults are the PRDs\': Manager all, Member content c r u and sites r, Viewer r on both, r on orders, forms and reports for Member and Viewer', () => {
  const all = (flags: Record<string, boolean>) => Object.values(flags).every(Boolean);
  const only = (flags: Record<string, boolean>, granted: string[]) =>
    Object.entries(flags).every(([flag, on]) => on === granted.includes(flag));

  for (const key of WEB_STUDIO_LEAVES) assert.ok(all(byKey[key].system_role_defaults.manager), `${key} manager`);

  assert.ok(only(byKey['webstudio.manage_content'].system_role_defaults.member, ['c', 'r', 'u']));
  assert.ok(only(byKey['webstudio.manage_sites'].system_role_defaults.member, ['r']));
  assert.ok(only(byKey['webstudio.manage_content'].system_role_defaults.viewer, ['r']));
  assert.ok(only(byKey['webstudio.manage_sites'].system_role_defaults.viewer, ['r']));
  // Part 2 (PRD V1.1 "Roles and permissions"): Member and Viewer see the Orders module; x stays with the Manager.
  assert.ok(only(byKey['webstudio.manage_orders'].system_role_defaults.member, ['r']));
  assert.ok(only(byKey['webstudio.manage_orders'].system_role_defaults.viewer, ['r']));
  // Part 3 (PRD V1.0 "Roles and permissions"): Member and Viewer read submissions and reports, and change neither.
  assert.ok(only(byKey['webstudio.manage_forms'].system_role_defaults.member, ['r']));
  assert.ok(only(byKey['webstudio.manage_forms'].system_role_defaults.viewer, ['r']));
  assert.ok(only(byKey['webstudio.manage_reports'].system_role_defaults.member, ['r']));
  assert.ok(only(byKey['webstudio.manage_reports'].system_role_defaults.viewer, ['r']));
});
