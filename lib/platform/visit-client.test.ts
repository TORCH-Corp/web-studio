import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import { VISIT_URL, forgetLastView, referrerHostOf, reportView, visitBody, type VisitBrowser } from './visit-client';

const PAGE = '11111111-2222-4333-8444-555555555555';
const OTHER_PAGE = '66666666-7777-4888-8999-aaaaaaaaaaaa';

interface Sent { url: string; init: { method: string; headers: Record<string, string>; body: string; keepalive: boolean } }

function browser(options: { pathname?: string; referrer?: string; prerendering?: boolean; fail?: boolean; refusal?: boolean } = {}) {
  const sent: Sent[] = [];
  const listeners: Array<() => void> = [];
  const state = { cancelled: 0 };
  const fake: VisitBrowser = {
    document: {
      referrer: options.referrer ?? '',
      prerendering: options.prerendering,
      addEventListener: (_type, listener) => void listeners.push(listener),
      removeEventListener: (_type, listener) => void listeners.splice(listeners.indexOf(listener), 1),
    },
    location: { pathname: options.pathname ?? '/' },
    fetch: (url, init) => {
      sent.push({ url, init });
      if (options.fail) return Promise.reject(new Error('offline'));
      // 204 has no body; a refusal (403, 429) has one.
      return Promise.resolve({ body: options.refusal ? { cancel: async () => void state.cancelled++ } : null });
    },
  };
  return { fake, sent, listeners, state };
}

beforeEach(() => forgetLastView());

test('only the referrer\'s host leaves the browser', () => {
  assert.equal(referrerHostOf('https://www.Google.com/search?q=a+private+question'), 'www.google.com');
  assert.equal(referrerHostOf('android-app://com.facebook.katana/'), 'com.facebook.katana');
  assert.equal(referrerHostOf(''), '');
  assert.equal(referrerHostOf('not an address'), '');
  assert.equal(visitBody(PAGE, '/about', 'https://t.co/abc'), JSON.stringify({ page_id: PAGE, path: '/about', referrer: 't.co' }));
});

test('a view is one POST to the page\'s own host, by a relative address', () => {
  const { fake, sent } = browser({ pathname: '/about', referrer: 'https://www.google.com/' });
  reportView(PAGE, fake);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, VISIT_URL);
  assert.ok(VISIT_URL.startsWith('/studio/api/') && !VISIT_URL.startsWith('//'));
  assert.equal(sent[0].init.method, 'POST');
  assert.equal(sent[0].init.keepalive, true);
  assert.deepEqual(JSON.parse(sent[0].init.body), { page_id: PAGE, path: '/about', referrer: 'www.google.com' });
});

test('a page that mounts twice for one view is counted once; another page or path is another view', () => {
  const { fake, sent } = browser({ pathname: '/blog/one' });
  reportView(PAGE, fake);
  reportView(PAGE, fake);
  assert.equal(sent.length, 1);
  fake.location.pathname = '/blog/two';
  reportView(PAGE, fake);
  reportView(OTHER_PAGE, fake);
  fake.location.pathname = '/blog/one';
  reportView(PAGE, fake);
  assert.deepEqual(sent.map((s) => JSON.parse(s.init.body).path), ['/blog/one', '/blog/two', '/blog/two', '/blog/one']);
});

test('a page the browser prerendered is counted when it is shown, and not if it never is', () => {
  const { fake, sent, listeners } = browser({ prerendering: true });
  const undo = reportView(PAGE, fake);
  assert.equal(sent.length, 0);
  assert.equal(listeners.length, 1);
  listeners[0]();
  assert.equal(sent.length, 1);

  forgetLastView();
  const never = browser({ prerendering: true });
  never.sent.length = 0;
  const stop = reportView(PAGE, never.fake);
  stop();
  assert.equal(never.listeners.length, 0);
  assert.equal(never.sent.length, 0);
  undo();
});

test('a request that fails changes nothing for the visitor', async () => {
  const { fake, sent } = browser({ fail: true });
  assert.doesNotThrow(() => reportView(PAGE, fake));
  await new Promise((resolve) => setImmediate(resolve)); // an unhandled rejection would fail the test run
  assert.equal(sent.length, 1);
});

test('the answer is not read: a refusal\'s body is discarded, so the request does not stay open', async () => {
  const { fake, sent, state } = browser({ refusal: true });
  reportView(PAGE, fake);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(sent.length, 1);
  assert.equal(state.cancelled, 1);
});
