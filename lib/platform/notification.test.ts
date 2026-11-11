import assert from 'node:assert/strict';
import { test } from 'node:test';

import { NotificationUnavailableError, sendNotification } from './notification';

const ENV = { NOTIFICATION_ENGINE_URL: 'http://notification-engine:6004/', NOTIFICATION_ENGINE_API_KEY: 'n-key' };
const ORG = '0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a';
const USER_A = '3a3a3a3a-3a3a-4a3a-8a3a-3a3a3a3a3a3a';
const USER_B = '3b3b3b3b-3b3b-4b3b-8b3b-3b3b3b3b3b3b';
const NOTIFICATION = { userIds: [USER_A, USER_B], title: 'New form submission', body: 'Sara sent Contact form on Al Noor.', target: 'torch://app/7d7d7d7d-7d7d-4d7d-8d7d-7d7d7d7d7d7d/sites/s/contact-form/c' };

test('one in-app notification is created per user, with the service key, the organization, the sender app web-studio and the link as its action', async () => {
  const seen: Array<{ url: string; method?: string; headers: Headers; body: Record<string, unknown> }> = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    seen.push({ url, method: init.method, headers: new Headers(init.headers), body: JSON.parse(String(init.body)) });
    return new Response(JSON.stringify({ id: 'n1' }), { status: 201 });
  }) as unknown as typeof fetch;
  const result = await sendNotification(ORG, NOTIFICATION, ENV, fetchImpl);
  assert.deepEqual(result, { notified: [USER_A, USER_B], failed: [] });
  assert.equal(seen.length, 2);
  assert.deepEqual(seen.map((call) => call.body.recipientUserId).sort(), [USER_A, USER_B]);
  for (const call of seen) {
    assert.equal(call.url, 'http://notification-engine:6004/api/notifications');
    assert.equal(call.method, 'POST');
    assert.equal(call.headers.get('x-service-api-key'), 'n-key');
    assert.equal(call.headers.get('x-entity-id'), ORG);
    assert.equal(call.headers.get('x-sender-app'), 'web-studio');
    assert.equal(call.headers.get('content-type'), 'application/json');
    assert.deepEqual({ ...call.body, recipientUserId: undefined }, {
      recipientUserId: undefined,
      channels: ['IN_APP'],
      title: NOTIFICATION.title,
      body: NOTIFICATION.body,
      category: 'TRANSACTIONAL',
      actionUrl: NOTIFICATION.target,
      metadata: { sourceEntityId: ORG },
    });
  }
});

test('a user listed twice is told once, and nobody to tell is no call', async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    return new Response(JSON.stringify({ id: 'n1' }), { status: 201 });
  }) as unknown as typeof fetch;
  assert.deepEqual((await sendNotification(ORG, { ...NOTIFICATION, userIds: [USER_A, USER_A] }, ENV, fetchImpl)).notified, [USER_A]);
  assert.equal(calls, 1);
  assert.deepEqual(await sendNotification(ORG, { ...NOTIFICATION, userIds: [] }, ENV, fetchImpl), { notified: [], failed: [] });
  assert.equal(calls, 1);
});

test('a user the service refused is in failed with the reason; the others are told and none is retried', async () => {
  const attempts = new Map<string, number>();
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    const user = (JSON.parse(String(init.body)) as { recipientUserId: string }).recipientUserId;
    attempts.set(user, (attempts.get(user) ?? 0) + 1);
    return user === USER_B ? new Response('{"message":"bad"}', { status: 400 }) : new Response(JSON.stringify({ id: 'n1' }), { status: 201 });
  }) as unknown as typeof fetch;
  const result = await sendNotification(ORG, NOTIFICATION, ENV, fetchImpl);
  assert.deepEqual(result.notified, [USER_A]);
  assert.equal(result.failed.length, 1);
  assert.equal(result.failed[0].userId, USER_B);
  assert.match(result.failed[0].error, /answered 400 to POST \/api\/notifications/);
  assert.deepEqual([...attempts.values()], [1, 1]);
});

test('an unreachable service fails every user, with why, and throws nothing', async () => {
  const down = (async () => {
    throw new TypeError('fetch failed');
  }) as unknown as typeof fetch;
  const result = await sendNotification(ORG, NOTIFICATION, ENV, down);
  assert.deepEqual(result.notified, []);
  assert.deepEqual(result.failed.map((failure) => failure.userId), [USER_A, USER_B]);
  assert.match(result.failed[0].error, /not reachable.*fetch failed/);
});

test('an answer that is not a created notification is a failure for that user', async () => {
  const result = await sendNotification(ORG, { ...NOTIFICATION, userIds: [USER_A] }, ENV, (async () => new Response('<html></html>', { status: 200 })) as unknown as typeof fetch);
  assert.deepEqual(result.notified, []);
  assert.match(result.failed[0].error, /unexpected body/);
});

test('no configuration is NotificationUnavailableError, once, before any call', async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    return new Response('{}');
  }) as unknown as typeof fetch;
  await assert.rejects(sendNotification(ORG, NOTIFICATION, {}, fetchImpl), (e: Error) => e instanceof NotificationUnavailableError && /NOTIFICATION_ENGINE_URL and NOTIFICATION_ENGINE_API_KEY are not set/.test(e.message));
  await assert.rejects(sendNotification(ORG, NOTIFICATION, { NOTIFICATION_ENGINE_URL: 'http://x' }, fetchImpl), NotificationUnavailableError);
  assert.equal(calls, 0);
});
