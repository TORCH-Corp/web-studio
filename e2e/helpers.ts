/**
 * Helpers for the e2e specs: a Business OS session through the dev login, the
 * sites API the shell calls, and anonymous requests to a published site by
 * host name (the way nginx forwards them, with `x-forwarded-host`).
 */

import { expect, request, type APIRequestContext, type APIResponse } from '@playwright/test';

export interface TestUser {
  sub: string;
  email: string;
  name?: string;
  org: string;
}

export interface SiteRecord {
  id: string;
  organization_id: string;
  name: string;
  slug: string;
  hosts: string[];
  default_locale: string;
  status?: 'draft' | 'published';
  last_published_at?: string | null;
}

export interface NewSite {
  name: string;
  slug: string;
  languages: Array<'ar' | 'en'>;
  default_language: 'ar' | 'en';
  hosts?: string[];
  template_id?: string;
}

/** A context whose cookie jar holds a Business OS session for `user`. */
export async function signIn(baseURL: string, user: TestUser): Promise<APIRequestContext> {
  const api = await request.newContext({ baseURL });
  const response = await api.post('/ycode/api/auth/dev-login', { data: user });
  expect(response.status(), await response.text()).toBe(200);
  return api;
}

export async function createSite(api: APIRequestContext, input: NewSite): Promise<SiteRecord> {
  const response = await api.post('/ycode/api/platform/sites', { data: input });
  expect(response.status(), await response.text()).toBe(201);
  return (await response.json()).data as SiteRecord;
}

export async function listSites(api: APIRequestContext): Promise<SiteRecord[]> {
  const response = await api.get('/ycode/api/platform/sites');
  expect(response.status(), await response.text()).toBe(200);
  return (await response.json()).data as SiteRecord[];
}

/** Open a site in the builder: the context's jar receives the ws_site cookie. */
export async function openSite(api: APIRequestContext, siteId: string): Promise<APIResponse> {
  return api.get(`/ycode/api/platform/sites/${siteId}/open`, { maxRedirects: 0 });
}

export async function publish(api: APIRequestContext): Promise<void> {
  const response = await api.post('/ycode/api/publish', { data: { publishAll: true } });
  expect(response.status(), await response.text()).toBe(200);
}

/** The value of a cookie in the context's jar, or undefined. */
export async function cookieNamed(api: APIRequestContext, name: string) {
  const { cookies } = await api.storageState();
  return cookies.find((cookie) => cookie.name === name);
}

/** Anonymous requests to one published site, by host name, with no cookies. */
export async function publishedSite(baseURL: string, host: string) {
  const anonymous = await request.newContext({ baseURL, extraHTTPHeaders: { 'x-forwarded-host': host } });
  return {
    get: (path: string) => anonymous.get(path, { maxRedirects: 0 }),
    dispose: () => anonymous.dispose(),
  };
}
