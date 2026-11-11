/**
 * The rules of visit counting (part 3, session W7; PRD V1.0 "Visit counting").
 *
 * What a view is turned into before it is stored: the visitor key of the day,
 * the source, the device type, and whether it is counted at all. The IP
 * address, the user agent and the referrer are read here and go no further:
 * none of them is stored or logged.
 *
 * Kept free of Next and React imports so it runs under `node --test`.
 */

import { createHmac } from 'crypto';

/** Where a view came from. */
export type VisitSource = 'direct' | 'search' | 'social' | 'referral';

/** What `sourceOf` answers: a source, or 'internal' for a view reached from the site's own page. */
export type VisitOrigin = VisitSource | 'internal';

export type VisitDevice = 'phone' | 'desktop' | 'tablet';

/** The body of a view, as the published page sends it. */
export interface VisitInput {
  pageId: string;
  /** The page's path, decoded, with no query and no trailing slash. */
  path: string;
  /** The host of the page's referrer; '' when there is none. */
  referrerHost: string;
}

/** The largest body the route reads. A view is a page id, a path and a host name. */
export const MAX_VISIT_BYTES = 2048;

const MAX_PATH_LENGTH = 512;
const MAX_HOST_LENGTH = 255;

/**
 * The day a visitor is recognised within, and the day the totals of session W8
 * are made for: the platform's day, as the store's rate day is
 * (lib/platform/store-money.ts).
 */
export const VISIT_TIME_ZONE = 'Asia/Baghdad';

const DAY = new Intl.DateTimeFormat('en-CA', { timeZone: VISIT_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });

/** The day of a moment, `YYYY-MM-DD`, in the platform's time zone. */
export const visitDay = (at: Date): string => DAY.format(at);

/** The shortest salt accepted: a shorter one could be found by trying. */
const MIN_SALT_LENGTH = 16;

/** The secret salt of the visitor key (`WS_VISIT_SALT`), or null when it is not set or too short to be a secret. */
export function visitSalt(env: Record<string, string | undefined> = process.env): string | null {
  const salt = env.WS_VISIT_SALT?.trim();
  return salt && salt.length >= MIN_SALT_LENGTH ? salt : null;
}

/**
 * The visitor key: who a view belongs to, for one site and one day.
 *
 * A keyed hash (HMAC-SHA-256 with the secret salt) of the site, the day, the
 * client IP and the user agent. Without the salt it cannot be turned back into
 * an address, nor checked against a guessed one; the day is part of it, so the
 * same person gets another key the next day, and the site is part of it, so
 * the same person is not followed from one site to another.
 */
export function visitorKey(visitor: { siteId: string; day: string; ip: string; userAgent: string }, salt: string): string {
  return createHmac('sha256', salt)
    .update(JSON.stringify([visitor.siteId, visitor.day, visitor.ip, visitor.userAgent]))
    .digest('hex');
}

/**
 * Programs that are not people, by what they call themselves: crawlers, link
 * previews, monitors, command-line clients and browsers driven by a program.
 * No user agent at all is one of them.
 */
const BOT_PATTERN = new RegExp(
  [
    'bot', 'crawl', 'spider', 'slurp', 'scrape', 'fetch', 'archiv', 'preview', 'monitor', 'uptime', 'pingdom',
    'headless', 'phantomjs', 'puppeteer', 'playwright', 'selenium', 'webdriver', 'lighthouse', 'pagespeed', 'gtmetrix',
    'facebookexternalhit', 'meta-external', 'whatsapp', 'skypeuripreview', 'embedly', 'quora link', 'vkshare',
    'curl', 'wget', 'httpie', 'python', 'java/', 'okhttp', 'go-http-client', 'node-fetch', 'axios', 'undici', 'libwww', 'httpclient',
    'postman', 'insomnia', 'scrapy', 'feedfetcher', 'mediapartners', 'adsbot', 'bingpreview',
    'semrush', 'ahrefs', 'mj12', 'dotbot', 'petalbot', 'bytespider', 'gptbot', 'claudebot', 'ccbot', 'perplexity',
  ].join('|'),
  'i',
);

/** Whether a user agent is a known bot. */
export function isBot(userAgent: string | null | undefined): boolean {
  const agent = userAgent?.trim();
  return !agent || BOT_PATTERN.test(agent);
}

/**
 * The device type, from the user agent. A tablet says "iPad", "Tablet" or
 * "Android" without "Mobile"; a phone says "Mobi", "iPhone" or "Android" with
 * "Mobile"; anything else is a desktop. An iPad that asks for the desktop site
 * calls itself a Mac and counts as a desktop: its user agent says nothing else.
 */
export function deviceOf(userAgent: string): VisitDevice {
  if (/ipad|tablet|playbook|silk|kindle/i.test(userAgent)) return 'tablet';
  if (/android/i.test(userAgent)) return /mobi/i.test(userAgent) ? 'phone' : 'tablet';
  if (/mobi|iphone|ipod|windows phone|blackberry|opera mini/i.test(userAgent)) return 'phone';
  return 'desktop';
}

/** Search engines, by the name in their host (`google.com`, `www.google.iq`, `search.yahoo.com`). */
const SEARCH_NAMES = ['google', 'bing', 'yahoo', 'duckduckgo', 'yandex', 'baidu', 'ecosia', 'startpage', 'qwant', 'naver', 'seznam'];

/** Search engines whose name is too common a word to match as a label. */
const SEARCH_HOSTS = ['search.brave.com', 'ask.com'];

/** Social networks and messengers, by host or parent host. */
const SOCIAL_HOSTS = [
  'facebook.com', 'fb.com', 'fb.me', 'messenger.com', 'instagram.com', 'threads.net', 'threads.com', 'twitter.com', 'x.com', 't.co',
  'linkedin.com', 'lnkd.in', 'youtube.com', 'youtu.be', 'tiktok.com', 'snapchat.com', 'pinterest.com', 'pin.it', 'reddit.com',
  'telegram.org', 't.me', 'telegram.me', 'whatsapp.com', 'wa.me', 'viber.com', 'vk.com',
];

/** Android apps that open a link name themselves as `android-app://{package}`: the package is the referrer's host. */
const SEARCH_APPS = ['com.google.android.googlequicksearchbox'];
const SOCIAL_APP_PREFIXES = [
  'com.facebook.', 'com.instagram.', 'com.twitter.', 'com.linkedin.', 'com.zhiliaoapp.musically', 'com.snapchat.', 'com.pinterest',
  'com.reddit.', 'org.telegram.', 'com.whatsapp', 'com.viber.', 'com.google.android.youtube',
];

const underHost = (host: string, parent: string) => host === parent || host.endsWith(`.${parent}`);

/** Whether a host is a search engine's: one of the names as the label before the ending (`google.com`, `google.co.uk`, `search.yahoo.com`). */
function isSearchHost(host: string): boolean {
  if (SEARCH_HOSTS.some((engine) => underHost(host, engine))) return true;
  // The ending is one label or two (`com`, `co.uk`), so the name is among the two labels before the last.
  return host.split('.').slice(-3, -1).some((label) => SEARCH_NAMES.includes(label));
}

/**
 * The source of a view, from the host of the page's referrer. No referrer is
 * 'direct'; the site's own host is 'internal' (the visitor was already on the
 * site, and the view takes the source he arrived with: lib/platform/visits.ts);
 * a search engine is 'search'; a social network or a messenger is 'social';
 * any other host is 'referral' (another site).
 */
export function sourceOf(referrerHost: string, ownHosts: readonly string[]): VisitOrigin {
  const host = referrerHost.trim().toLowerCase().replace(/^www\./, '');
  if (!host) return 'direct';
  if (ownHosts.some((own) => own.toLowerCase().replace(/^www\./, '') === host)) return 'internal';
  if (SEARCH_APPS.includes(host) || isSearchHost(host)) return 'search';
  if (SOCIAL_APP_PREFIXES.some((prefix) => host.startsWith(prefix)) || SOCIAL_HOSTS.some((social) => underHost(host, social))) return 'social';
  return 'referral';
}

/** Headers a browser sends with a request it makes ahead of a visit. */
const PREFETCH_HEADERS = ['sec-purpose', 'purpose', 'x-purpose', 'x-moz'];

/** Whether a request was made ahead of a visit (a prefetch or a prerender), not by a page somebody is looking at. */
export function isPrefetch(headers: Headers): boolean {
  return PREFETCH_HEADERS.some((name) => /prefetch|prerender|preview/i.test(headers.get(name) ?? ''));
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HOST_PATTERN = /^[a-z0-9._\-[\]:]*$/;
// eslint-disable-next-line no-control-regex -- control characters are what the path must not hold
const CONTROL_PATTERN = /[\u0000-\u001f\u007f]/;

/** A page's path as it is stored: decoded, no query or fragment, no trailing slash; null when it is not a path. */
export function normalisePath(value: string): string | null {
  const raw = value.split(/[?#]/)[0];
  if (!raw.startsWith('/') || raw.startsWith('//')) return null;
  let decoded: string;
  try {
    decoded = decodeURI(raw);
  } catch {
    return null; // not a path a browser would send
  }
  const path = decoded.length > 1 ? decoded.replace(/\/+$/, '') || '/' : decoded;
  if (path.length > MAX_PATH_LENGTH || CONTROL_PATTERN.test(path)) return null;
  return path;
}

/** The view a body holds, or null when it is not one. */
function viewOf(body: Record<string, unknown>): VisitInput | null {
  const { page_id: pageId, path, referrer = '' } = body;
  if (typeof pageId !== 'string' || !UUID_PATTERN.test(pageId)) return null;
  if (typeof path !== 'string' || typeof referrer !== 'string') return null;
  const normalised = normalisePath(path);
  if (!normalised) return null;
  const referrerHost = referrer.trim().toLowerCase();
  if (referrerHost.length > MAX_HOST_LENGTH || !HOST_PATTERN.test(referrerHost)) return null;
  return { pageId: pageId.toLowerCase(), path: normalised, referrerHost };
}

/** The JSON object a body is, or null. */
function objectOf(raw: string): Record<string, unknown> | null {
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return null;
  }
  return typeof body === 'object' && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
}

/**
 * Read the body of a view: `{ page_id, path, referrer }`, where `referrer` is
 * the host of the page's referrer or ''. Null when it is not that.
 */
export function parseVisit(raw: string): VisitInput | null {
  const body = objectOf(raw);
  return body ? viewOf(body) : null;
}

/** What a published page reports to its own host: one view of a page, or one add to cart. */
export type VisitReport = { kind: 'view'; view: VisitInput } | { kind: 'add_to_cart' };

/**
 * Read what a page reports (session W8). A body with no `kind` is a view, as the
 * page of session W7 sends it (`kind: 'view'` says so too); `{ kind: 'add_to_cart' }`
 * is the store's add to cart and carries nothing else: nothing else in the body
 * is read. Any other kind, an order or a form submission included, is refused:
 * those two are written by the server when the order is made and the form is
 * stored, never on a browser's word (lib/platform/visit-events.ts). Null when the
 * body is none of these.
 */
export function parseReport(raw: string): VisitReport | null {
  const body = objectOf(raw);
  if (!body) return null;
  if (!('kind' in body) || body.kind === 'view') {
    const view = viewOf(body);
    return view ? { kind: 'view', view } : null;
  }
  return body.kind === 'add_to_cart' ? { kind: 'add_to_cart' } : null;
}
