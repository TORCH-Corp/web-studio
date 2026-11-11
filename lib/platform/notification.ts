/**
 * Notification Center client: the in-app notification a new form submission
 * raises (part 3, session W5; PRD V1.0 "Notification"). Notification Center is
 * `notification-engine`. This is a hand-written client of the route Sales's
 * `NotificationClient` calls (`apps/sales-service/src/clients/notification.client.ts`),
 * with the same contract:
 *
 *   POST /api/notifications  { recipientUserId, channels: ['IN_APP'], title, body,
 *        category: 'TRANSACTIONAL', actionUrl, metadata: { sourceEntityId } }
 *        → 201 { id }. One recipient per call; the engine neither translates
 *        nor targets by permission, so the caller gives the user ids and the
 *        text. Guarded by `x-service-api-key` (the engine's own key); the
 *        organization goes in `x-entity-id` and in `metadata.sourceEntityId`
 *        (the engine reads the header first, the body in a pre-handler, and
 *        refuses a service-key create that names none); `x-sender-app` records
 *        which app raised it. `actionUrl` must be an absolute URL.
 *
 * One call per user, a few at a time, none retried (a retry could tell a user
 * twice). A failure for one user never stops the others: the result names who
 * was told and who was not, with why, and the caller logs it. Only a missing
 * configuration throws, once, before any call.
 *
 * NOTIFICATION_ENGINE_URL and NOTIFICATION_ENGINE_API_KEY come from the
 * environment (the names Sales and the production compose use). Kept free of
 * Next imports so it runs under `node --test`.
 */

import { mapLimit } from '@/lib/platform/map-limit';

/** Notification Center is not configured. A call that fails is a user in `failed`, never this. */
export class NotificationUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotificationUnavailableError';
  }
}

export interface Notification {
  userIds: string[];
  title: string;
  body: string;
  /** The absolute URL that opens the record, sent as the notification's actionUrl. */
  target: string;
}

export interface NotifyResult {
  /** The users the engine accepted a notification for. */
  notified: string[];
  /** The users it did not, each with why. */
  failed: Array<{ userId: string; error: string }>;
}

type Env = Record<string, string | undefined>;

const TIMEOUT_MS = 5_000;
/** How many users are told at the same time. */
const CONCURRENCY = 5;
const OPERATION = 'POST /api/notifications';

function config(env: Env): { baseUrl: string; apiKey: string } {
  const baseUrl = env.NOTIFICATION_ENGINE_URL?.trim().replace(/\/+$/, '');
  const apiKey = env.NOTIFICATION_ENGINE_API_KEY?.trim();
  if (!baseUrl || !apiKey) throw new NotificationUnavailableError('NOTIFICATION_ENGINE_URL and NOTIFICATION_ENGINE_API_KEY are not set');
  return { baseUrl, apiKey };
}

/** One user's notification; the reason it was not created is the error message. */
async function notifyOne(organizationId: string, userId: string, notification: Notification, baseUrl: string, apiKey: string, fetchImpl: typeof fetch): Promise<string | null> {
  let response: Response;
  try {
    response = await fetchImpl(`${baseUrl}/api/notifications`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-service-api-key': apiKey, 'x-entity-id': organizationId, 'x-sender-app': 'web-studio' },
      body: JSON.stringify({
        recipientUserId: userId,
        channels: ['IN_APP'],
        title: notification.title,
        body: notification.body,
        category: 'TRANSACTIONAL',
        actionUrl: notification.target,
        metadata: { sourceEntityId: organizationId },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    return `Notification Center is not reachable (${OPERATION}): ${error instanceof Error ? error.message : String(error)}`;
  }
  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 200);
    return `Notification Center answered ${response.status} to ${OPERATION}${detail ? `: ${detail}` : ''}`;
  }
  const created = (await response.json().catch(() => undefined)) as { id?: unknown } | undefined;
  return typeof created?.id === 'string' ? null : `Notification Center answered ${OPERATION} with an unexpected body`;
}

/** One in-app notification per user of the organization, none retried; see the file's header. */
export async function sendNotification(organizationId: string, notification: Notification, env: Env = process.env, fetchImpl: typeof fetch = fetch): Promise<NotifyResult> {
  const { baseUrl, apiKey } = config(env);
  const userIds = Array.from(new Set(notification.userIds));
  const errors = await mapLimit(userIds, CONCURRENCY, (userId) => notifyOne(organizationId, userId, notification, baseUrl, apiKey, fetchImpl));
  const result: NotifyResult = { notified: [], failed: [] };
  userIds.forEach((userId, index) => {
    const error = errors[index];
    if (error === null) result.notified.push(userId);
    else result.failed.push({ userId, error });
  });
  return result;
}
