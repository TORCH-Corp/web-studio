import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';

import { hasMarkOffsetDefect, joinMarks, joinMarksInString } from './arabic-marks';

const J = '\u034f';
const FATHATAN = '\u064b';
const WEBKIT_GTK = 'Mozilla/5.0 (X11; Ubuntu; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/60.5 Safari/605.1.15';

test('the three words of the bug get a joiner right after the tanween, and nothing else moves', () => {
  for (const word of ['مرحباً', 'وفريقاً', 'قصيراً']) {
    assert.equal(joinMarksInString(word), word + J);
  }
  assert.equal(joinMarksInString('مرحباً بكم، وفريقاً.'), `مرحباً${J} بكم، وفريقاً${J}.`);
});

test('a run of marks gets one joiner after the whole run, mid-word marks included', () => {
  // shadda + fatha on the same letter, then more letters: the joiner follows the run, not each mark
  const word = 'مُحَمَّد';
  const joined = joinMarksInString(word);
  assert.equal(joined, `مُ${J}حَ${J}مَّ${J}د`);
  assert.equal(joined.replaceAll(J, ''), word);
});

test('text without marks is returned as it came, and a second pass adds nothing', () => {
  assert.equal(joinMarksInString('مرحبا بكم'), 'مرحبا بكم');
  assert.equal(joinMarksInString('Hello 2026'), 'Hello 2026');
  assert.equal(joinMarksInString(''), '');
  const once = joinMarksInString('كتاباً وَقَدْ');
  assert.equal(joinMarksInString(once), once);
});

test('only Arabic marks count: other combining marks and U+08E2 are left alone', () => {
  assert.equal(joinMarksInString('e\u0301'), 'e\u0301'); // Latin acute accent
  assert.equal(joinMarksInString('\u08e2'), '\u08e2'); // disputed end of ayah, a format character
  assert.equal(joinMarksInString(`ا${FATHATAN}`), `ا${FATHATAN}${J}`);
});

test('the engine gate: WebKit on Linux only', () => {
  assert.equal(hasMarkOffsetDefect(WEBKIT_GTK), true);
  assert.equal(hasMarkOffsetDefect('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15 Epiphany/46.0'), true);
  for (const agent of [
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36', // Chrome on Linux
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0', // WebView2
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15', // WKWebView, CoreText
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64; rv:125.0) Gecko/20100101 Firefox/125.0',
    '',
  ]) {
    assert.equal(hasMarkOffsetDefect(agent), false, agent);
  }
});

test('joinMarks leaves the text alone outside WebKitGTK, and changes only strings inside it', () => {
  assert.equal(joinMarks('مرحباً', 'Mozilla/5.0 Chrome/124.0.0.0'), 'مرحباً');
  assert.equal(joinMarks('مرحباً', ''), 'مرحباً');
  assert.equal(joinMarks('مرحباً', WEBKIT_GTK), `مرحباً${J}`);
  assert.equal(joinMarks(undefined, WEBKIT_GTK), undefined);
  assert.equal(joinMarks(null, WEBKIT_GTK), null);
  assert.equal(joinMarks(42, WEBKIT_GTK), 42);
});

test('joinMarks walks rich text: nested elements, arrays and keys survive, void elements stay as they are', () => {
  const tree = [
    React.createElement('strong', { key: 'a', className: 'b' }, 'مرحباً'),
    ' وفريقاً ',
    React.createElement('span', { key: 'c' }, 'one', React.createElement('em', { key: 'd' }, 'قصيراً')),
    React.createElement('br', { key: 'e' }),
  ];

  const out = joinMarks(tree, WEBKIT_GTK) as React.ReactElement[];
  assert.ok(Array.isArray(out) && out.length === 4);
  assert.deepEqual(out.map((node) => (typeof node === 'string' ? node : node.key)), ['a', ` وفريقاً${J} `, 'c', 'e']);

  const strong = out[0] as React.ReactElement<{ className: string; children: string }>;
  assert.equal(strong.type, 'strong');
  assert.equal(strong.props.className, 'b');
  assert.equal(strong.props.children, `مرحباً${J}`);

  const span = out[2] as React.ReactElement<{ children: [string, React.ReactElement<{ children: string }>] }>;
  assert.equal(span.props.children[0], 'one');
  assert.equal(span.props.children[1].props.children, `قصيراً${J}`);
  assert.equal(out[3], tree[3], 'an element with no children is returned as it is');
});

test('the input is never changed: the layer text stays what it was', () => {
  const element = React.createElement('p', { key: 'p' }, 'مرحباً');
  const tree = [element, 'وفريقاً'];
  joinMarks(tree, WEBKIT_GTK);
  assert.equal((element.props as { children: string }).children, 'مرحباً');
  assert.deepEqual(tree, [element, 'وفريقاً']);
});
