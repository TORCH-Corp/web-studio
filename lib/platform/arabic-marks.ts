/**
 * Arabic marks in the builder canvas (part 2, session 13; part 1 RELEASE.md, bug 5).
 *
 * The bug: in the builder canvas, a word that carries tanween (مرحباً) sits above
 * the line, and so does every word of a fully vowelled text. It is not a
 * difference between the canvas and the published page: the two share the font
 * and the CSS, and the published page shows the same defect in the same engine.
 * It is WebKitGTK's, the engine Tauri uses on Linux. Its text path applies the
 * vertical offset the font gives a mark (about 0.45 em for tanween in IBM Plex
 * Sans Arabic) to the letters of the word as well. HarfBuzz returns the right
 * positions (checked with 8.3.0 and 15.0.0), and Chromium draws them right (checked).
 * Not checked here: WebView2 is Chromium, and WKWebView shapes with CoreText, not
 * HarfBuzz, so neither should share this. The symptom is WebKit bug 205784 ("Arabic
 * diacritics makes lines unaligned vertically", fixed for 2.26.3); whether this is that
 * bug again with the Skia port or a neighbour of it is not known, and it is not reported
 * upstream. No CSS changes it: the only property that removes the raise is
 * `font-feature-settings: "mark" 0`, which also drops the mark's placement.
 *
 * What does change it: a combining grapheme joiner (U+034F) right after the marks.
 * It draws nothing and is transparent to Arabic joining, so cursive letters stay
 * joined (a zero-width non-joiner would split them, a zero-width joiner would join
 * what must not be), and the word is drawn on the line again. Measured in
 * WebKitGTK 2.52.6 with IBM Plex Sans Arabic on single words, sentences, text
 * mixed with Latin letters and digits, and fully vowelled text.
 *
 * So the canvas adds it, and only where the defect is: on screen, in the text
 * the canvas renders, in WebKitGTK. The layer's data is never changed, the
 * published page is never touched, the in-place text editor starts from the
 * layer's own text, and every other engine renders what it rendered before.
 * Drop this file and its calls in components/LayerRenderer.tsx (the import, `displayedText`
 * and the four places it is rendered) when WebKitGTK is fixed.
 */

import React from 'react';

/** U+034F COMBINING GRAPHEME JOINER. */
const JOINER = '\u034f';

/**
 * Arabic combining marks: Quranic annotation marks (0610-061A), the vowel marks and
 * tanween (064B-065F), the superscript alef (0670), the Quranic marks (06D6-06DC,
 * 06DF-06E4, 06E7-06E8, 06EA-06ED) and the extended marks (08D3-08E1, 08E3-08FF; 08E2,
 * the disputed end of ayah, is a format character, not a mark).
 */
const MARKS = '\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06dc\u06df-\u06e4\u06e7\u06e8\u06ea-\u06ed\u08d3-\u08e1\u08e3-\u08ff';

/** A whole run of marks that the joiner does not follow yet (the lookahead also stops a backtrack from cutting a run in two). */
const UNJOINED_RUN = new RegExp(`([${MARKS}]+)(?![${MARKS}${JOINER}])`, 'g');

/**
 * WebKit on Linux (WebKitGTK, Tauri's webview there, GNOME Web): WebKit and Linux
 * in the user agent, and neither Chromium's tokens nor Android's.
 */
export function hasMarkOffsetDefect(userAgent: string): boolean {
  return /AppleWebKit/.test(userAgent) && /\bLinux\b/.test(userAgent) && !/Chrome|Chromium|CriOS|Edg|OPR|Android/.test(userAgent);
}

/** The text with a joiner after every run of Arabic marks. Running it twice changes nothing more. */
export function joinMarksInString(text: string): string {
  return text.replace(UNJOINED_RUN, `$1${JOINER}`);
}

function joinMarksIn(node: React.ReactNode): React.ReactNode {
  if (typeof node === 'string') return joinMarksInString(node);
  if (Array.isArray(node)) return node.map(joinMarksIn);
  if (!React.isValidElement(node)) return node;

  const children = (node.props as { children?: React.ReactNode }).children;
  if (children === undefined || children === null) return node;
  // The rich text renderer passes an element's children as separate arguments; so does this.
  return Array.isArray(children)
    ? React.cloneElement(node, undefined, ...children.map(joinMarksIn))
    : React.cloneElement(node, undefined, joinMarksIn(children));
}

/**
 * What the canvas puts on screen for a layer's text: the same text, with the joiner
 * after the Arabic marks when the engine needs it. `userAgent` is for tests; the
 * canvas passes nothing and the browser's own is used.
 */
export function joinMarks(node: React.ReactNode, userAgent?: string): React.ReactNode {
  const agent = userAgent ?? (typeof navigator === 'undefined' ? '' : navigator.userAgent);
  return hasMarkOffsetDefect(agent) ? joinMarksIn(node) : node;
}
