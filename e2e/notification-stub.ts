/**
 * Notification Center, and the two Organization Setup reads that choose who is
 * told, in the platform stub's server (e2e/platform-stub.ts), recording every
 * call so a spec can count them (part 3, session W5). Shapes are the live
 * services' as lib/platform/notification.ts and lib/platform/org-setup.ts
 * document them.
 *
 * Notification Center, `x-service-api-key` (401) and `x-entity-id` (400), as notification-engine's create route:
 *   POST /api/notifications { recipientUserId (uuid), channels, title (1 to 200), body, category, actionUrl (an
 *        absolute URL), metadata.sourceEntityId (the organization, when given) } → 201 { id }; 400 for a body that
 *        breaks one of those. Every call is recorded, a refused or a 503 one included.
 *
 * Organization Setup, `x-service-api-key` (401):
 *   POST /api/internal/people/members { entityId, limit? } → { people: [{ id, displayName, avatarUrl }], nextCursor }:
 *        the people of e2e/auth-fixtures.ts, in user-id order, whatever the organization
 *   POST /api/internal/authz/evaluate { userId, entityId, leafKey, flag } → { allowed }: the person's own flag on the
 *        leaf in e2e/auth-fixtures.ts; a user the fixtures do not know holds nothing
 *
 * For the specs:
 *   GET  /__calls?service=notification|org-setup   { calls: [{ path, entityId, headers, body, status, response }] }
 *        (the org-setup calls are these two routes' only)
 *   POST /__notification/delay { ms }              each notification waits this long before it answers
 *   POST /__down { services: ['notification' | 'org-setup', …] } is the platform stub's: those answer 503
 */

import type http from 'node:http';
import { randomUUID } from 'node:crypto';
import { PEOPLE, personBySub } from './auth-fixtures';
import { NOTIFICATION_KEY, ORG_SETUP_KEY } from './platform-fixtures';

export type NotificationService = 'notification' | 'org-setup';

type Reply = (response: http.ServerResponse, status: number, body: unknown) => void;

interface Call {
  path: string;
  entityId: string | null;
  headers: { senderApp: string | null };
  body: unknown;
  status: number;
  response: unknown;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FLAGS = ['c', 'r', 'u', 'd', 'x', 'export', 'use_ai'];
const CHANNELS = ['EMAIL', 'WHATSAPP', 'IN_APP'];
const CATEGORIES = ['SYSTEM', 'TRANSACTIONAL', 'MARKETING', 'ALERT', 'REMINDER', 'SOCIAL'];

const calls: Record<NotificationService, Call[]> = { notification: [], 'org-setup': [] };
let delayMs = 0;

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

async function readBody(request: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null');
  } catch {
    return undefined;
  }
}

function header(request: http.IncomingMessage, name: string): string | null {
  const value = request.headers[name];
  return typeof value === 'string' ? value : null;
}

function answer(service: NotificationService, request: http.IncomingMessage, response: http.ServerResponse, json: Reply, path: string, body: unknown, status: number, payload: unknown): void {
  calls[service].push({ path, entityId: header(request, 'x-entity-id'), headers: { senderApp: header(request, 'x-sender-app') }, body, status, response: payload });
  json(response, status, payload);
}

async function createNotification(request: http.IncomingMessage, response: http.ServerResponse, json: Reply, down: boolean): Promise<void> {
  const path = '/api/notifications';
  const body = await readBody(request);
  if (request.headers['x-service-api-key'] !== NOTIFICATION_KEY) return answer('notification', request, response, json, path, body, 401, { statusCode: 401, error: 'Unauthorized' });
  if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
  if (down) return answer('notification', request, response, json, path, body, 503, { statusCode: 503, error: 'Service Unavailable' });
  const entityId = header(request, 'x-entity-id');
  if (!entityId || !UUID.test(entityId)) return answer('notification', request, response, json, path, body, 400, { statusCode: 400, code: 'organization_required' });
  const refuse = (message: string) => answer('notification', request, response, json, path, body, 400, { statusCode: 400, error: 'Bad Request', message });
  if (!isObject(body)) return refuse('body must be an object');
  if (typeof body.recipientUserId !== 'string' || !UUID.test(body.recipientUserId)) return refuse('recipientUserId must be a uuid');
  if (!Array.isArray(body.channels) || body.channels.length === 0 || !body.channels.every((channel) => CHANNELS.includes(String(channel)))) return refuse('channels must name channels');
  if (typeof body.title !== 'string' || body.title.length < 1 || body.title.length > 200) return refuse('title must be 1 to 200 characters');
  if (typeof body.body !== 'string' || body.body.length < 1) return refuse('body must not be empty');
  if (body.category !== undefined && !CATEGORIES.includes(String(body.category))) return refuse('category is not one of the engine\'s');
  if (body.actionUrl !== undefined) {
    try {
      new URL(String(body.actionUrl));
    } catch {
      return refuse('actionUrl must be an absolute URL');
    }
  }
  if (isObject(body.metadata) && body.metadata.sourceEntityId !== undefined && body.metadata.sourceEntityId !== entityId) return refuse('metadata.sourceEntityId must be the organization of x-entity-id');
  return answer('notification', request, response, json, path, body, 201, { id: randomUUID() });
}

async function listMembers(request: http.IncomingMessage, response: http.ServerResponse, json: Reply, down: boolean): Promise<void> {
  const path = '/api/internal/people/members';
  const body = await readBody(request);
  if (request.headers['x-service-api-key'] !== ORG_SETUP_KEY) return answer('org-setup', request, response, json, path, body, 401, { statusCode: 401, error: 'Unauthorized' });
  if (down) return answer('org-setup', request, response, json, path, body, 503, { statusCode: 503, error: 'Service Unavailable' });
  const limit = isObject(body) && typeof body.limit === 'number' ? body.limit : 50;
  if (!isObject(body) || typeof body.entityId !== 'string' || !UUID.test(body.entityId) || !Number.isInteger(limit) || limit < 1 || limit > 500) {
    return answer('org-setup', request, response, json, path, body, 400, { statusCode: 400, error: 'Bad Request' });
  }
  const everyone = Object.values(PEOPLE).sort((a, b) => a.sub.localeCompare(b.sub));
  return answer('org-setup', request, response, json, path, body, 200, {
    people: everyone.slice(0, limit).map((person) => ({ id: person.sub, displayName: person.name, avatarUrl: null })),
    nextCursor: everyone.length > limit ? everyone[limit - 1].sub : null,
  });
}

async function evaluate(request: http.IncomingMessage, response: http.ServerResponse, json: Reply, down: boolean): Promise<void> {
  const path = '/api/internal/authz/evaluate';
  const body = await readBody(request);
  if (request.headers['x-service-api-key'] !== ORG_SETUP_KEY) return answer('org-setup', request, response, json, path, body, 401, { statusCode: 401, error: 'Unauthorized' });
  if (down) return answer('org-setup', request, response, json, path, body, 503, { statusCode: 503, error: 'Service Unavailable' });
  const valid =
    isObject(body) &&
    typeof body.userId === 'string' && UUID.test(body.userId) &&
    typeof body.entityId === 'string' && UUID.test(body.entityId) &&
    typeof body.leafKey === 'string' && body.leafKey !== '' &&
    typeof body.flag === 'string' && FLAGS.includes(body.flag);
  if (!valid) return answer('org-setup', request, response, json, path, body, 400, { statusCode: 400, error: 'Bad Request' });
  const { userId, leafKey, flag } = body as { userId: string; leafKey: string; flag: string };
  return answer('org-setup', request, response, json, path, body, 200, { allowed: personBySub(userId)?.permissions[leafKey]?.[flag] === true });
}

/** Answers the routes above; false for any other, so the platform stub goes on to its next handler. */
export async function handleNotificationServices(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  url: URL,
  isDown: (service: NotificationService) => boolean,
  json: Reply,
): Promise<boolean> {
  const path = url.pathname;
  const method = request.method;
  if (method === 'POST' && path === '/api/notifications') {
    await createNotification(request, response, json, isDown('notification'));
    return true;
  }
  if (method === 'POST' && path === '/api/internal/people/members') {
    await listMembers(request, response, json, isDown('org-setup'));
    return true;
  }
  if (method === 'POST' && path === '/api/internal/authz/evaluate') {
    await evaluate(request, response, json, isDown('org-setup'));
    return true;
  }
  const service = url.searchParams.get('service');
  if (method === 'GET' && path === '/__calls' && (service === 'notification' || service === 'org-setup')) {
    json(response, 200, { calls: calls[service] });
    return true;
  }
  if (method === 'POST' && path === '/__notification/delay') {
    const body = await readBody(request);
    delayMs = isObject(body) && typeof body.ms === 'number' ? body.ms : 0;
    json(response, 200, { ms: delayMs });
    return true;
  }
  return false;
}
