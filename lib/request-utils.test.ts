import assert from 'node:assert/strict';
import { test } from 'node:test';

import { getClientIp } from './request-utils';

/**
 * What nginx sends (docker/nginx/web-studio-proxy.conf): `X-Real-IP` is
 * `$remote_addr`, the address that reached nginx; `X-Forwarded-For` is whatever
 * the visitor sent, with `$remote_addr` appended after it.
 */
function behindNginx(remoteAddr: string, visitorSent?: string): Headers {
  return new Headers({
    'x-real-ip': remoteAddr,
    'x-forwarded-for': visitorSent ? `${visitorSent}, ${remoteAddr}` : remoteAddr,
  });
}

test('the visitor behind nginx is the address nginx saw, whatever the visitor put in X-Forwarded-For', () => {
  assert.equal(getClientIp(behindNginx('198.51.100.7')), '198.51.100.7');
  assert.equal(getClientIp(behindNginx('198.51.100.7', '203.0.113.1')), '198.51.100.7');
  assert.equal(getClientIp(behindNginx('198.51.100.7', '203.0.113.2, 203.0.113.3')), '198.51.100.7');
});

test('a script that sends its own X-Forwarded-For every time keeps one address, so it keeps one count', () => {
  const counts = new Map<string, number>();
  for (let i = 1; i <= 5; i++) {
    const ip = getClientIp(behindNginx('198.51.100.7', `203.0.113.${i}`));
    assert.ok(ip);
    counts.set(ip, (counts.get(ip) ?? 0) + 1);
  }
  assert.deepEqual([...counts], [['198.51.100.7', 5]]);
});

test('without X-Real-IP the last X-Forwarded-For entry is the visitor, never the first', () => {
  const headers = new Headers({ 'x-forwarded-for': '203.0.113.1, 203.0.113.2, 198.51.100.7' });
  assert.equal(getClientIp(headers), '198.51.100.7');
  assert.equal(getClientIp(new Headers({ 'x-forwarded-for': '198.51.100.7' })), '198.51.100.7');
});

test('spaces and empty entries are ignored', () => {
  assert.equal(getClientIp(new Headers({ 'x-real-ip': '  198.51.100.7 ' })), '198.51.100.7');
  assert.equal(getClientIp(new Headers({ 'x-forwarded-for': '203.0.113.1,  198.51.100.7  , ' })), '198.51.100.7');
  assert.equal(getClientIp(new Headers({ 'x-real-ip': ' ', 'x-forwarded-for': '198.51.100.7' })), '198.51.100.7');
});

test('no forwarding header is no address, so the rate limit is skipped rather than shared', () => {
  assert.equal(getClientIp(new Headers()), null);
  assert.equal(getClientIp(new Headers({ 'x-forwarded-for': ' , ' })), null);
});
