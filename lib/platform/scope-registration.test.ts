import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  SCOPE_REGISTERED_EVENT,
  ScopeReregistration,
  handleAppInstalled,
  resolveScopeRegistrationSetup,
  scopeRegistration,
  type Log,
} from './scope-registration';

const APP_ID = 'de4944b6-b43a-4cc5-96fe-c1d38852b61d';
const ORG_A = '0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a';
const ORG_B = '0b0b0b0b-0b0b-4b0b-8b0b-0b0b0b0b0b0b';
const quiet: Log = { info: () => undefined, warn: () => undefined };

test('a registration names the app, the organization and the four-leaf scope', () => {
  const registration = scopeRegistration(APP_ID, ORG_A) as { app_id: string; app_name: string; entity_id: string; scope: { app_id: string; modules: unknown[] } };
  assert.equal(registration.app_id, APP_ID);
  assert.equal(registration.app_name, 'Web Studio');
  assert.equal(registration.entity_id, ORG_A);
  assert.equal(registration.scope.app_id, APP_ID);
  assert.equal(registration.scope.modules.length, 3);
});

test('app.installed registers the scope for Web Studio installs only, and only with an organization', () => {
  const published: Array<[string, Record<string, unknown>]> = [];
  const deps = { appId: APP_ID, publish: (event: string, payload: Record<string, unknown>) => published.push([event, payload]) };

  assert.equal(handleAppInstalled({ app_id: APP_ID, entity_id: ORG_A }, deps), true);
  assert.equal(handleAppInstalled({ app_id: APP_ID, org_id: ORG_B }, deps), true);
  assert.equal(handleAppInstalled({ app_id: 'another-app', entity_id: ORG_A }, deps), false);
  assert.equal(handleAppInstalled({ app_id: APP_ID }, deps), false);
  assert.equal(handleAppInstalled({}, deps), false);

  assert.deepEqual(published.map(([event, payload]) => [event, payload.entity_id]), [[SCOPE_REGISTERED_EVENT, ORG_A], [SCOPE_REGISTERED_EVENT, ORG_B]]);
});

test('the start-up run publishes one registration per installed organization', async () => {
  const published: string[] = [];
  const run = new ScopeReregistration({
    appId: APP_ID,
    listInstalled: async () => [ORG_A, ORG_B],
    publish: async (_event, payload) => { published.push(payload.entity_id as string); return true; },
    log: quiet,
  });
  assert.deepEqual(await run.runOnce(), { registered: true, organizations: 2 });
  assert.deepEqual(published, [ORG_A, ORG_B]);
});

test('a run reports why it failed and never throws', async () => {
  const unavailable = new ScopeReregistration({ appId: APP_ID, listInstalled: async () => { throw new Error('app-management answered 503'); }, publish: async () => true, log: quiet });
  assert.deepEqual(await unavailable.runOnce(), { registered: false, reason: 'LIST_UNAVAILABLE', error: 'app-management answered 503' });

  const refused = new ScopeReregistration({ appId: APP_ID, listInstalled: async () => [ORG_A, ORG_B], publish: async (_e, payload) => payload.entity_id === ORG_A, log: quiet });
  assert.deepEqual(await refused.runOnce(), { registered: false, reason: 'PUBLISH_FAILED', organizations: 2, failed: 1 });

  const throwing = new ScopeReregistration({ appId: APP_ID, listInstalled: async () => [ORG_A], publish: async () => { throw new Error('bus closed'); }, log: quiet });
  assert.deepEqual(await throwing.runOnce(), { registered: false, reason: 'PUBLISH_FAILED', organizations: 1, failed: 1 });
});

test('a failed start-up run is tried again until one succeeds, then stops', async () => {
  let attempts = 0;
  const published: string[] = [];
  let done!: () => void;
  const finished = new Promise<void>((resolve) => { done = resolve; });
  const run = new ScopeReregistration({
    appId: APP_ID,
    listInstalled: async () => { attempts += 1; if (attempts < 3) throw new Error('not yet'); return [ORG_A]; },
    publish: async (_event, payload) => { published.push(payload.entity_id as string); return true; },
    log: { ...quiet, info: () => done() },
    firstRetryDelayMs: 5,
  });
  run.start();
  await finished;
  await run.stop();
  assert.equal(attempts, 3);
  assert.deepEqual(published, [ORG_A]);
});

test('the set-up says what is missing, and runs without app-management as install-only', () => {
  assert.match((resolveScopeRegistrationSetup({}) as { reason: string }).reason, /EVENT_BUS_REDIS_URL/);
  assert.match((resolveScopeRegistrationSetup({ EVENT_BUS_REDIS_URL: 'redis://redis:6379' }) as { reason: string }).reason, /WS_APP_ID/);

  const installOnly = resolveScopeRegistrationSetup({ EVENT_BUS_REDIS_URL: 'redis://redis:6379', WS_APP_ID: APP_ID });
  assert.ok(installOnly.run && installOnly.appManagement === null && /APP_MANAGEMENT/.test(installOnly.warning ?? ''));

  const full = resolveScopeRegistrationSetup({ EVENT_BUS_REDIS_URL: 'redis://redis:6379', WS_APP_ID: APP_ID, APP_MANAGEMENT_URL: 'http://app-management-service:6000/', APP_MANAGEMENT_API_KEY: 'k' });
  assert.ok(full.run && full.appManagement?.baseUrl === 'http://app-management-service:6000/' && full.warning === null);
});
