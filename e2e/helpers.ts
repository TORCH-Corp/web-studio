/**
 * Helpers for the e2e specs: a Business OS session through the dev login, the
 * sites API the shell calls, and anonymous requests to a published site by
 * host name (the way nginx forwards them, with `x-forwarded-host`).
 */

import { expect, request, type APIRequestContext, type APIResponse } from '@playwright/test';

/** The TORCH templates organization of the e2e environment (session 4): WS_TEMPLATES_ORG of the test server. */
export const TEMPLATES_ORG = '7e7e7e7e-7e7e-4e7e-8e7e-7e7e7e7e7e7e';

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
  is_template: boolean;
  template: { name: { ar: string; en: string }; description: { ar: string; en: string } } | null;
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
  is_template?: boolean;
  template?: { name?: { ar?: string; en?: string }; description?: { ar?: string; en?: string } };
}

/** A context whose cookie jar holds a Business OS session for `user`, through the dev login. */
export async function signIn(baseURL: string, user: TestUser): Promise<APIRequestContext> {
  const api = await request.newContext({ baseURL });
  const response = await api.post('/ycode/api/auth/dev-login', { data: user });
  expect(response.status(), await response.text()).toBe(200);
  return api;
}

/** The entrance the shell uses: the access token (and optionally the site) through the callback, as a browser navigation. */
export async function callback(api: APIRequestContext, token: string, site?: string, headers?: Record<string, string>): Promise<APIResponse> {
  const params = new URLSearchParams({ token });
  if (site) params.set('site', site);
  return api.get(`/ycode/api/auth/callback?${params}`, { maxRedirects: 0, headers });
}

/** A context whose cookie jar holds the session the callback minted for `token`; the callback must have accepted it. */
export async function signInWithToken(baseURL: string, token: string, site?: string): Promise<APIRequestContext> {
  const api = await request.newContext({ baseURL });
  const response = await callback(api, token, site);
  expect(response.status(), await response.text()).toBe(303);
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

/** The domain default addresses live under in the e2e run (WS_SITES_DOMAIN in playwright.config.ts). */
export const TEST_SITES_DOMAIN = 'sites.test';

interface PageRow {
  id: string;
  slug: string;
  is_index: boolean;
  error_page: number | null;
}

/** The draft pages of the open site. */
export async function draftPages(api: APIRequestContext): Promise<PageRow[]> {
  const response = await api.get('/ycode/api/pages');
  expect(response.status(), await response.text()).toBe(200);
  return (await response.json()).data as PageRow[];
}

/** Layers for a page: one heading with `text`, which is what a visitor reads. */
export function headingLayers(text: string) {
  return [
    {
      id: 'body',
      name: 'body',
      classes: '',
      children: [
        {
          id: `heading-${text.replace(/\W+/g, '-').toLowerCase()}`,
          name: 'heading',
          settings: { tag: 'h1' },
          classes: '',
          children: [],
          variables: {
            text: {
              type: 'dynamic_rich_text',
              data: { content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] } },
            },
          },
        },
      ],
    },
  ];
}

/** Replace a page's draft layers with one heading. */
export async function setHeading(api: APIRequestContext, pageId: string, text: string): Promise<void> {
  const response = await api.put(`/ycode/api/layers?page_id=${pageId}`, { data: { layers: headingLayers(text) } });
  expect(response.status(), await response.text()).toBe(200);
}
