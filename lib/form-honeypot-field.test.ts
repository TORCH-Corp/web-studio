import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { FormHoneypotField } from '@/components/FormHoneypotField';
import { HONEYPOT_FIELD_NAME } from '@/lib/form-spam-settings';

const markup = () => renderToStaticMarkup(createElement(FormHoneypotField));
const style = () => /<div[^>]*style="([^"]*)"/.exec(markup())?.[1] ?? '';

/**
 * OPEN_QUESTIONS 52: the decoy sat at `left: -9999px`. An Arabic page is
 * `<html dir="rtl">`, where the scrollable overflow runs to the left, so every
 * published form made the page 9,999 px too wide. The offset follows the
 * direction now: on the side the page starts on, which never scrolls.
 */
test('the decoy is moved off the side a page starts on, not off its left, so an Arabic page does not scroll sideways', () => {
  const css = style();
  assert.match(css, /inset-inline-start:\s*-9999px/);
  assert.doesNotMatch(css, /(^|;)\s*(left|right)\s*:/, 'a physical offset is scrollable on the page of the other direction');
});

test('the decoy stays out of sight for a person and present for a bot: positioned, 1px, clipped, not display none', () => {
  const css = style();
  assert.match(css, /position:\s*absolute/);
  assert.match(css, /width:\s*1px/);
  assert.match(css, /height:\s*1px/);
  assert.match(css, /overflow:\s*hidden/);
  assert.doesNotMatch(css, /display:\s*none|visibility:\s*hidden/);
  const html = markup();
  assert.match(html, /aria-hidden="true"/);
  assert.match(html, new RegExp(`<input[^>]*name="${HONEYPOT_FIELD_NAME}"`));
  assert.match(html, /<input[^>]*tabindex="-1"/);
  assert.match(html, /<input[^>]*autoComplete="off"|<input[^>]*autocomplete="off"/i);
});
