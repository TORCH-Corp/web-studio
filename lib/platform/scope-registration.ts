/**
 * Registering the `webstudio` permission scope with auth-service (part 1,
 * session 2; OPEN_QUESTIONS item 10, answered 1 Nov 2026).
 *
 * The platform's apps publish their scope on the SHARED core event bus: Redis
 * pub/sub at EVENT_BUS_REDIS_URL, channel `core-events:<event>`, JSON envelope
 * `{event_id, event, payload, timestamp}`. auth-service consumes
 * `app.permission_scope.registered` and merges the leaves into every
 * permission profile of that organization. This is the same mechanism as
 * contact-center-service's permission-scope.handler.ts and
 * scope-reregistration.ts, written for one Node service instead of Fastify.
 *
 * Registration is keyed by (app_id, entity_id). Both come from `app.installed`,
 * which app-management publishes when an organization subscribes to Web Studio
 * (WS_APP_ID is Web Studio's catalogue id). At start the scope is published
 * again for every organization that already has the app installed, asked from
 * app-management (`GET /api/internal/entitlements/apps/{appId}/installed-entities`,
 * service key), so a leaf added later reaches them too; auth-service keeps the
 * grants administrators already made and gives defaults only to new leaves.
 *
 * Best effort by design: a bus that is down, or a missing variable, is logged
 * and never stops the server. Started once from instrumentation.ts.
 */

import Redis from 'ioredis';
import { WEB_STUDIO_APP_NAME, buildWebStudioScope } from './web-studio-scope';

export const CORE_EVENTS_PREFIX = 'core-events:';
export const APP_INSTALLED_EVENT = 'app.installed';
export const SCOPE_REGISTERED_EVENT = 'app.permission_scope.registered';

export const FIRST_RETRY_DELAY_MS = 60_000;
export const MAX_RETRY_DELAY_MS = 30 * 60_000;
const APP_MANAGEMENT_TIMEOUT_MS = 10_000;

export interface Log {
  info(details: Record<string, unknown>, message: string): void;
  warn(details: Record<string, unknown>, message: string): void;
}

export const consoleLog: Log = {
  info: (details, message) => console.info(`[web-studio scope] ${message}`, details),
  warn: (details, message) => console.warn(`[web-studio scope] ${message}`, details),
};

export interface CoreEventEnvelope {
  event_id: string;
  event: string;
  payload: Record<string, unknown>;
  timestamp: string;
}

/** The registration of the webstudio scope for one organization: what both the install handler and the start-up run publish. */
export function scopeRegistration(appId: string, entityId: string): Record<string, unknown> {
  return { app_id: appId, app_name: WEB_STUDIO_APP_NAME, entity_id: entityId, scope: buildWebStudioScope(appId) };
}

export interface AppInstalledPayload {
  app_id?: string;
  app_name?: string;
  entity_id?: string;
  org_id?: string;
}

/** On `app.installed` for Web Studio, publish the scope for that organization. Every service sees every install; the others are ignored. True when published. */
export function handleAppInstalled(
  payload: AppInstalledPayload,
  deps: { appId: string; publish: (event: string, payload: Record<string, unknown>) => unknown },
): boolean {
  const entityId = payload?.entity_id ?? payload?.org_id;
  if (!payload?.app_id || !entityId || payload.app_id !== deps.appId) return false;
  deps.publish(SCOPE_REGISTERED_EVENT, scopeRegistration(deps.appId, entityId));
  return true;
}

/** The shared bus: one connection to publish, one to subscribe (a subscribed Redis connection cannot publish). */
export class CoreBus {
  private readonly pub: Redis;
  private readonly sub: Redis;

  constructor(redisUrl: string, private readonly log: Log) {
    // lazyConnect so construction cannot throw on an unreachable bus.
    const options = { lazyConnect: true, maxRetriesPerRequest: null } as const;
    this.pub = new Redis(redisUrl, options);
    this.sub = new Redis(redisUrl, options);
    for (const [name, client] of [['publisher', this.pub], ['subscriber', this.sub]] as const) {
      client.on('error', (error: Error) => this.log.warn({ err: error.message }, `core-events ${name} error`));
    }
  }

  async connect(): Promise<void> {
    await Promise.all([this.pub.connect(), this.sub.connect()]);
  }

  async on(event: string, handler: (payload: Record<string, unknown>) => void): Promise<void> {
    const channel = `${CORE_EVENTS_PREFIX}${event}`;
    await this.sub.subscribe(channel);
    this.sub.on('message', (received: string, raw: string) => {
      if (received !== channel) return;
      try {
        const envelope = JSON.parse(raw) as CoreEventEnvelope;
        handler(envelope.payload ?? {});
      } catch (error) {
        // A malformed message from another service must not take this one down.
        this.log.warn({ err: error instanceof Error ? error.message : String(error), channel }, 'unreadable core event');
      }
    });
  }

  /** Never throws. False when the bus refused it, which is logged here. */
  async publish(event: string, payload: Record<string, unknown>): Promise<boolean> {
    const envelope: CoreEventEnvelope = { event_id: crypto.randomUUID(), event, payload, timestamp: new Date().toISOString() };
    try {
      await this.pub.publish(`${CORE_EVENTS_PREFIX}${event}`, JSON.stringify(envelope));
      return true;
    } catch (error) {
      this.log.warn({ err: error instanceof Error ? error.message : String(error), event }, 'core event publish failed');
      return false;
    }
  }

  async close(): Promise<void> {
    await Promise.allSettled([this.pub.quit(), this.sub.quit()]);
  }
}

export class InstalledOrganizationsUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InstalledOrganizationsUnavailableError';
  }
}

/** Which organizations have Web Studio installed, as app-management records it. Any failure throws; an empty list is an answer. */
export class InstalledOrganizations {
  private readonly baseUrl: string;

  constructor(private readonly config: { baseUrl: string; serviceKey: string; timeoutMs?: number }) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
  }

  async list(appId: string): Promise<string[]> {
    const url = `${this.baseUrl}/api/internal/entitlements/apps/${encodeURIComponent(appId)}/installed-entities`;
    let response: Response;
    try {
      response = await fetch(url, {
        headers: { 'x-service-api-key': this.config.serviceKey },
        cache: 'no-store',
        signal: AbortSignal.timeout(this.config.timeoutMs ?? APP_MANAGEMENT_TIMEOUT_MS),
      });
    } catch (error) {
      throw new InstalledOrganizationsUnavailableError(`app-management could not be reached at ${url} (${error instanceof Error ? error.message : String(error)})`);
    }
    if (!response.ok) {
      throw new InstalledOrganizationsUnavailableError(`app-management answered ${response.status} at ${url}`);
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new InstalledOrganizationsUnavailableError(`app-management answered with a body that is not JSON at ${url}`);
    }
    const ids = (body as { entityIds?: unknown } | null)?.entityIds;
    if (!Array.isArray(ids) || !ids.every((id) => typeof id === 'string' && id !== '')) {
      throw new InstalledOrganizationsUnavailableError(`app-management answered without a list of organization ids at ${url}`);
    }
    return ids;
  }
}

export interface ScopeReregistrationDeps {
  appId: string;
  listInstalled(appId: string): Promise<string[]>;
  publish(event: string, payload: Record<string, unknown>): Promise<boolean>;
  log: Log;
  firstRetryDelayMs?: number;
  maxRetryDelayMs?: number;
}

export type ReregistrationResult =
  | { registered: true; organizations: number }
  | { registered: false; reason: 'LIST_UNAVAILABLE'; error: string }
  | { registered: false; reason: 'PUBLISH_FAILED'; organizations: number; failed: number }
  | { registered: false; reason: 'STOPPED' };

/**
 * Publishes the scope again, at start, for every organization that has Web
 * Studio installed. A run that fails (app-management unreachable, the bus
 * refusing) is logged and tried again a minute later, then twice as long each
 * time, up to every 30 minutes, until one run succeeds. Never throws.
 */
export class ScopeReregistration {
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;
  private stopped = false;
  private failures = 0;

  constructor(private readonly deps: ScopeReregistrationDeps) {}

  start(): void {
    this.stopped = false;
    this.failures = 0;
    this.schedule(0);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    await this.running;
  }

  async runOnce(): Promise<ReregistrationResult> {
    let entityIds: string[];
    try {
      entityIds = await this.deps.listInstalled(this.deps.appId);
    } catch (error) {
      return { registered: false, reason: 'LIST_UNAVAILABLE', error: error instanceof Error ? error.message : String(error) };
    }
    let failed = 0;
    for (const entityId of entityIds) {
      if (this.stopped) return { registered: false, reason: 'STOPPED' };
      if (!(await this.publishOne(entityId))) failed += 1;
    }
    if (failed > 0) return { registered: false, reason: 'PUBLISH_FAILED', organizations: entityIds.length, failed };
    return { registered: true, organizations: entityIds.length };
  }

  private async publishOne(entityId: string): Promise<boolean> {
    try {
      return await this.deps.publish(SCOPE_REGISTERED_EVENT, scopeRegistration(this.deps.appId, entityId));
    } catch (error) {
      this.deps.log.warn({ entityId, err: error instanceof Error ? error.message : String(error) }, 'publishing the webstudio scope registration threw');
      return false;
    }
  }

  private schedule(delayMs: number): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.running = this.runAndReschedule().finally(() => {
        this.running = null;
      });
    }, delayMs);
    this.timer.unref();
  }

  private async runAndReschedule(): Promise<void> {
    const result = await this.runOnce();
    if (result.registered) {
      this.deps.log.info({ appId: this.deps.appId, organizations: result.organizations }, 'webstudio permission scope registered for every organization with Web Studio installed');
      return;
    }
    if (result.reason === 'STOPPED') return;
    this.failures += 1;
    const retryInMs = Math.min((this.deps.firstRetryDelayMs ?? FIRST_RETRY_DELAY_MS) * 2 ** (this.failures - 1), this.deps.maxRetryDelayMs ?? MAX_RETRY_DELAY_MS);
    this.deps.log.warn({ appId: this.deps.appId, ...result, retryInMs }, 'could not register the webstudio permission scope for the installed organizations; will retry');
    this.schedule(retryInMs);
  }
}

/** EVENT_BUS_REDIS_URL, WS_APP_ID, APP_MANAGEMENT_URL and APP_MANAGEMENT_API_KEY, from process.env or a test's object. */
export type ScopeRegistrationEnv = Record<string, string | undefined>;

export type ScopeRegistrationSetup =
  | { run: true; busUrl: string; appId: string; appManagement: { baseUrl: string; serviceKey: string } | null; warning: string | null }
  | { run: false; reason: string };

/** Whether registration can run here, decided once at start: nothing below changes without a restart. */
export function resolveScopeRegistrationSetup(env: ScopeRegistrationEnv): ScopeRegistrationSetup {
  const busUrl = env.EVENT_BUS_REDIS_URL?.trim();
  if (!busUrl) {
    return { run: false, reason: 'EVENT_BUS_REDIS_URL is not set: not joining the core event bus, so the webstudio permission scope is not registered and no organization can grant Web Studio permissions.' };
  }
  const appId = env.WS_APP_ID?.trim();
  if (!appId) {
    return { run: false, reason: 'WS_APP_ID is not set: an app.installed event cannot be told apart from other apps\', so the webstudio permission scope is not registered. Set it to Web Studio\'s catalogue id.' };
  }
  const baseUrl = env.APP_MANAGEMENT_URL?.trim();
  const serviceKey = env.APP_MANAGEMENT_API_KEY?.trim();
  if (!baseUrl || !serviceKey) {
    return {
      run: true,
      busUrl,
      appId,
      appManagement: null,
      warning: 'APP_MANAGEMENT_URL or APP_MANAGEMENT_API_KEY is not set: the scope registers on app.installed only, not again at start for the organizations that already have Web Studio.',
    };
  }
  return { run: true, busUrl, appId, appManagement: { baseUrl, serviceKey }, warning: null };
}

export interface ScopeRegistrationHandle {
  stop(): Promise<void>;
}

const globalForScope = globalThis as unknown as { __webStudioScopeRegistration?: ScopeRegistrationHandle | null };

/** Join the bus, answer app.installed, and register again for the installed organizations. Null when it cannot run; never throws. */
export async function startScopeRegistration(env: ScopeRegistrationEnv = process.env, log: Log = consoleLog): Promise<ScopeRegistrationHandle | null> {
  if (globalForScope.__webStudioScopeRegistration) return globalForScope.__webStudioScopeRegistration;

  const setup = resolveScopeRegistrationSetup(env);
  if (!setup.run) {
    log.warn({}, setup.reason);
    return null;
  }
  if (setup.warning) log.warn({}, setup.warning);

  let bus: CoreBus;
  try {
    bus = new CoreBus(setup.busUrl, log);
    await bus.connect();
  } catch (error) {
    log.warn({ err: error instanceof Error ? error.message : String(error) }, 'could not join the core event bus; the webstudio permission scope is not registered');
    return null;
  }

  await bus.on(APP_INSTALLED_EVENT, (payload) => {
    if (handleAppInstalled(payload as AppInstalledPayload, { appId: setup.appId, publish: (event, data) => void bus.publish(event, data) })) {
      log.info({ entityId: (payload as AppInstalledPayload).entity_id ?? (payload as AppInstalledPayload).org_id }, 'webstudio permission scope registered on app.installed');
    }
  });

  let reregistration: ScopeReregistration | null = null;
  if (setup.appManagement) {
    const installed = new InstalledOrganizations(setup.appManagement);
    reregistration = new ScopeReregistration({
      appId: setup.appId,
      listInstalled: (appId) => installed.list(appId),
      publish: (event, data) => bus.publish(event, data),
      log,
    });
    reregistration.start();
  }

  log.info({ appId: setup.appId, reregisterAtStart: Boolean(reregistration) }, 'core event bus joined; webstudio permission scope registration armed');

  const handle: ScopeRegistrationHandle = {
    async stop() {
      globalForScope.__webStudioScopeRegistration = null;
      await reregistration?.stop();
      await bus.close();
    },
  };
  globalForScope.__webStudioScopeRegistration = handle;
  return handle;
}
