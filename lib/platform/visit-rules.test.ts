import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MAX_VISIT_BYTES, deviceOf, isBot, isPrefetch, normalisePath, parseVisit, sourceOf, visitDay, visitSalt, visitorKey } from './visit-rules';

const SALT = 'a-salt-of-the-unit-tests';
const SITE = '3f0b2c7e-2d7a-4c3e-9a1e-7b1d2e3f4a5b';
const OTHER_SITE = '9a1e7b1d-2e3f-4a5b-8c7e-3f0b2c7e2d7a';
const PAGE = '11111111-2222-4333-8444-555555555555';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
const ANDROID_PHONE = 'Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
const ANDROID_TABLET = 'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const IPAD = 'Mozilla/5.0 (iPad; CPU OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1';
const WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15';
const FIREFOX_LINUX = 'Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0';

const visitor = { siteId: SITE, day: '2026-11-11', ip: '198.51.100.7', userAgent: IPHONE };

test('the same person on the same site and day has one key', () => {
  assert.equal(visitorKey(visitor, SALT), visitorKey({ ...visitor }, SALT));
  assert.match(visitorKey(visitor, SALT), /^[0-9a-f]{64}$/);
});

test('the next day, another site, another address or another browser gives another key', () => {
  const key = visitorKey(visitor, SALT);
  assert.notEqual(visitorKey({ ...visitor, day: '2026-11-12' }, SALT), key);
  assert.notEqual(visitorKey({ ...visitor, siteId: OTHER_SITE }, SALT), key);
  assert.notEqual(visitorKey({ ...visitor, ip: '198.51.100.8' }, SALT), key);
  assert.notEqual(visitorKey({ ...visitor, userAgent: WINDOWS }, SALT), key);
});

test('the key depends on the secret salt and holds nothing of the address or the browser', () => {
  const key = visitorKey(visitor, SALT);
  assert.notEqual(visitorKey(visitor, 'another-salt-of-the-tests'), key);
  assert.ok(!key.includes('198') && !key.toLowerCase().includes('iphone'));
});

test('the parts of the key cannot run into each other', () => {
  const a = visitorKey({ siteId: SITE, day: '2026-11-11', ip: '10.0.0.1', userAgent: '1 Mozilla' }, SALT);
  const b = visitorKey({ siteId: SITE, day: '2026-11-11', ip: '10.0.0.11', userAgent: ' Mozilla' }, SALT);
  assert.notEqual(a, b);
});

test('the salt comes from WS_VISIT_SALT; unset or too short is no salt', () => {
  assert.equal(visitSalt({ WS_VISIT_SALT: '  0123456789abcdef  ' }), '0123456789abcdef');
  assert.equal(visitSalt({}), null);
  assert.equal(visitSalt({ WS_VISIT_SALT: '' }), null);
  assert.equal(visitSalt({ WS_VISIT_SALT: 'short' }), null);
});

test('the day is the platform\'s day in Baghdad, which starts at 21:00 UTC', () => {
  assert.equal(visitDay(new Date('2026-11-11T20:59:59Z')), '2026-11-11');
  assert.equal(visitDay(new Date('2026-11-11T21:00:00Z')), '2026-11-12');
  assert.equal(visitDay(new Date('2026-11-12T10:00:00Z')), '2026-11-12');
});

test('the device type: phone, tablet, desktop', () => {
  assert.equal(deviceOf(IPHONE), 'phone');
  assert.equal(deviceOf(ANDROID_PHONE), 'phone');
  assert.equal(deviceOf(ANDROID_TABLET), 'tablet');
  assert.equal(deviceOf(IPAD), 'tablet');
  assert.equal(deviceOf('Mozilla/5.0 (Linux; Android 11; KFTRWI) AppleWebKit/537.36 (KHTML, like Gecko) Silk/120.4.1 like Chrome/120.0.0.0 Safari/537.36'), 'tablet');
  assert.equal(deviceOf('Mozilla/5.0 (Android 14; Mobile; rv:132.0) Gecko/132.0 Firefox/132.0'), 'phone');
  assert.equal(deviceOf(WINDOWS), 'desktop');
  assert.equal(deviceOf(MAC), 'desktop');
  assert.equal(deviceOf(FIREFOX_LINUX), 'desktop');
  assert.equal(deviceOf('something nobody has seen'), 'desktop');
});

test('the source: no referrer is direct, the site\'s own host is internal', () => {
  const own = ['acme.sites.torchcorp.com', 'www.acme.iq'];
  assert.equal(sourceOf('', own), 'direct');
  assert.equal(sourceOf('  ', own), 'direct');
  assert.equal(sourceOf('acme.sites.torchcorp.com', own), 'internal');
  assert.equal(sourceOf('ACME.iq', own), 'internal');
  assert.equal(sourceOf('www.acme.iq', own), 'internal');
  assert.equal(sourceOf('other.sites.torchcorp.com', own), 'referral');
});

test('the source: search engines, with any ending', () => {
  for (const host of ['www.google.com', 'google.iq', 'www.google.co.uk', 'www.bing.com', 'search.yahoo.com', 'duckduckgo.com', 'yandex.ru', 'www.baidu.com', 'search.brave.com', 'www.ecosia.org', 'com.google.android.googlequicksearchbox']) {
    assert.equal(sourceOf(host, []), 'search', host);
  }
});

test('the source: social networks and messengers, with their short links and apps', () => {
  for (const host of ['www.facebook.com', 'l.facebook.com', 'm.facebook.com', 'l.instagram.com', 'instagram.com', 't.co', 'x.com', 'www.linkedin.com', 'lnkd.in', 'www.youtube.com', 'youtu.be', 'www.tiktok.com', 't.me', 'web.telegram.org', 'web.whatsapp.com', 'wa.me', 'com.facebook.katana', 'org.telegram.messenger', 'com.instagram.android']) {
    assert.equal(sourceOf(host, []), 'social', host);
  }
});

test('the source: any other host is another site, a look-alike included', () => {
  for (const host of ['example.com', 'news.example.iq', 'notfacebook.com', 'x.com.example.org', 'mygoogle.com', 'brave.com', '203.0.113.9']) {
    assert.equal(sourceOf(host, []), 'referral', host);
  }
});

test('known bots are not people', () => {
  for (const agent of [
    'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)',
    'Mozilla/5.0 (compatible; YandexBot/3.0; +http://yandex.com/bots)',
    'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
    'WhatsApp/2.23.20.0 A',
    'TelegramBot (like TwitterBot)',
    'Twitterbot/1.0',
    'Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)',
    'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/130.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Linux; Android 11; moto g power) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36 Chrome-Lighthouse',
    'UptimeRobot/2.0',
    'curl/8.5.0',
    'Wget/1.21.4',
    'python-requests/2.32.3',
    'Go-http-client/2.0',
    'axios/1.7.7',
  ]) {
    assert.equal(isBot(agent), true, agent);
  }
  assert.equal(isBot(''), true);
  assert.equal(isBot('   '), true);
  assert.equal(isBot(null), true);
  assert.equal(isBot(undefined), true);
});

test('browsers people use are not bots', () => {
  for (const agent of [
    IPHONE, ANDROID_PHONE, ANDROID_TABLET, IPAD, WINDOWS, MAC, FIREFOX_LINUX,
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 YaBrowser/24.10.0.0 Safari/537.36',
    'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.0.0 Mobile DuckDuckGo/5 Safari/537.36',
    'Mozilla/5.0 (Linux; Android 14; SM-A546E Build/UP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.0.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/485.0.0.0;]',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/22B83 Instagram 355.0.0 (iPhone15,3; iOS 18_1; en_IQ)',
  ]) {
    assert.equal(isBot(agent), false, agent);
  }
});

test('a request made ahead of a visit is a prefetch', () => {
  assert.equal(isPrefetch(new Headers({ 'sec-purpose': 'prefetch' })), true);
  assert.equal(isPrefetch(new Headers({ 'sec-purpose': 'prefetch;prerender' })), true);
  assert.equal(isPrefetch(new Headers({ purpose: 'prefetch' })), true);
  assert.equal(isPrefetch(new Headers({ 'x-moz': 'prefetch' })), true);
  assert.equal(isPrefetch(new Headers({ 'x-purpose': 'preview' })), true);
  assert.equal(isPrefetch(new Headers({ 'user-agent': WINDOWS })), false);
});

test('a path is stored decoded, without its query and its trailing slash', () => {
  assert.equal(normalisePath('/'), '/');
  assert.equal(normalisePath('/about'), '/about');
  assert.equal(normalisePath('/about/'), '/about');
  assert.equal(normalisePath('/blog/post?p_x=2#top'), '/blog/post');
  assert.equal(normalisePath('/%D9%85%D9%86-%D9%86%D8%AD%D9%86'), '/من-نحن');
  assert.equal(normalisePath('/ar/من-نحن'), '/ar/من-نحن');
});

test('what is not a path is refused', () => {
  assert.equal(normalisePath(''), null);
  assert.equal(normalisePath('about'), null);
  assert.equal(normalisePath('//evil.example/x'), null);
  assert.equal(normalisePath('https://example.com/x'), null);
  assert.equal(normalisePath('/%E0%A4%A'), null);
  assert.equal(normalisePath('/a\nb'), null);
  assert.equal(normalisePath(`/${'a'.repeat(600)}`), null);
});

test('the body of a view is a page id, a path and the referrer\'s host', () => {
  assert.deepEqual(parseVisit(JSON.stringify({ page_id: PAGE.toUpperCase(), path: '/about/', referrer: 'WWW.Google.com' })), {
    pageId: PAGE,
    path: '/about',
    referrerHost: 'www.google.com',
  });
  assert.deepEqual(parseVisit(JSON.stringify({ page_id: PAGE, path: '/' })), { pageId: PAGE, path: '/', referrerHost: '' });
  // Anything else in the body is not read.
  assert.deepEqual(parseVisit(JSON.stringify({ page_id: PAGE, path: '/', referrer: '', name: 'Sara', ip: '10.0.0.1' })), { pageId: PAGE, path: '/', referrerHost: '' });
});

test('a body that is not a view is refused', () => {
  for (const raw of [
    '',
    'not json',
    '[]',
    'null',
    '"text"',
    JSON.stringify({ path: '/' }),
    JSON.stringify({ page_id: 'not-a-uuid', path: '/' }),
    JSON.stringify({ page_id: PAGE }),
    JSON.stringify({ page_id: PAGE, path: 'about' }),
    JSON.stringify({ page_id: PAGE, path: 7 }),
    JSON.stringify({ page_id: PAGE, path: '/', referrer: 7 }),
    JSON.stringify({ page_id: PAGE, path: '/', referrer: 'https://www.google.com/search?q=secret' }),
    JSON.stringify({ page_id: PAGE, path: '/', referrer: `${'a'.repeat(300)}.com` }),
  ]) {
    assert.equal(parseVisit(raw), null, raw);
  }
});

test('the size cap leaves room for the longest path the route accepts', () => {
  const longest = JSON.stringify({ page_id: PAGE, path: `/${'ع'.repeat(500)}`, referrer: `${'a'.repeat(250)}.com` });
  assert.ok(Buffer.byteLength(longest, 'utf8') <= MAX_VISIT_BYTES);
  assert.notEqual(parseVisit(longest), null);
});
