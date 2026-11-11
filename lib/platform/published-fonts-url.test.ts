import assert from 'node:assert/strict';
import { test } from 'node:test';

import { rewriteGoogleFontCss } from './font-mirror-url';
import { EXPORTED_FONT_FILES_BASE, exportedFontKey, googleCssQuery, mirroredFilePaths, PUBLISHED_FONT_FILES_BASE, publishedFontFilePath, toExportedFontCss, toPublishedFontCss } from './published-fonts-url';

/** Google's stylesheet for a family, as fonts.googleapis.com answers a modern browser: one rule per subset. */
const GOOGLE_CSS = `
/* arabic */
@font-face { font-family: 'IBM Plex Sans Arabic'; font-weight: 400; src: url(https://fonts.gstatic.com/s/ibmplexsansarabic/v15/Qw3CZRtWPQCuHme67tEYUIx3Kh0PHR9N6Ys43PW5fslBEg0.woff2) format('woff2'); unicode-range: U+0600-06FF; }
/* latin */
@font-face { font-family: 'IBM Plex Sans Arabic'; font-weight: 400; src: url(https://fonts.gstatic.com/s/ibmplexsansarabic/v15/Qw3CZRtWPQCuHme67tEYUIx3Kh0PHR9N6Ys93PW5fslB.woff2) format('woff2'); unicode-range: U+0000-00FF; }
/* latin, bold: the same file is named twice in a variable family's sheet */
@font-face { font-family: 'IBM Plex Sans Arabic'; font-weight: 700; src: url(https://fonts.gstatic.com/s/ibmplexsansarabic/v15/Qw3CZRtWPQCuHme67tEYUIx3Kh0PHR9N6Ys93PW5fslB.woff2) format('woff2'); unicode-range: U+0000-00FF; }
`;
/** The same sheet as the mirror keeps it (font-mirror.ts). */
const MIRRORED = rewriteGoogleFontCss(GOOGLE_CSS);

test('a site\'s Google font is asked of the mirror by its css2 query; any other URL is not a Google font', () => {
  assert.equal(googleCssQuery('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;700&display=swap'), 'family=IBM+Plex+Sans+Arabic:wght@400;700&display=swap');
  assert.equal(googleCssQuery('https://fonts.googleapis.com/css2?'), null);
  assert.equal(googleCssQuery('https://example.com/css2?family=Inter'), null);
  assert.equal(googleCssQuery('/ycode/api/fonts/mirror/css2?family=Inter'), null);
});

test('a published page\'s font rules point every file at the site\'s own host, and name no Google host', () => {
  const css = toPublishedFontCss(MIRRORED);
  assert.ok(!/gstatic|googleapis/.test(css));
  assert.ok(!css.includes('/ycode/api/fonts/mirror'), 'the mirror\'s own routes are the signed-in builder\'s');
  assert.equal(css.split(`url(${PUBLISHED_FONT_FILES_BASE}/ibmplexsansarabic/v15/`).length - 1, 3);
  assert.ok(css.includes('unicode-range: U+0600-06FF'), 'the rules are otherwise Google\'s own');
});

test('the files a sheet names are the ones a visitor may fetch: each once, by the mirror\'s path', () => {
  assert.deepEqual(mirroredFilePaths(MIRRORED), [
    's/ibmplexsansarabic/v15/Qw3CZRtWPQCuHme67tEYUIx3Kh0PHR9N6Ys43PW5fslBEg0.woff2',
    's/ibmplexsansarabic/v15/Qw3CZRtWPQCuHme67tEYUIx3Kh0PHR9N6Ys93PW5fslB.woff2',
  ]);
  assert.deepEqual(mirroredFilePaths('body { color: red }'), []);
});

test('the anonymous route reads a request as a mirror path: a family, a version and a file, or nothing', () => {
  assert.equal(publishedFontFilePath(['ibmplexsansarabic', 'v15', 'x.woff2']), 's/ibmplexsansarabic/v15/x.woff2');
  assert.equal(publishedFontFilePath(['ibmplexsansarabic', 'x.woff2']), null);
  assert.equal(publishedFontFilePath([]), null);
  // What a page names is exactly what the route is asked for.
  const [first] = mirroredFilePaths(MIRRORED);
  const asked = toPublishedFontCss(MIRRORED).match(new RegExp(`${PUBLISHED_FONT_FILES_BASE}/([^)]+)`))![1];
  assert.equal(publishedFontFilePath(asked.split('/')), first);
});

test('an exported site\'s font rules point every file at a copy the export carries, and name no Google host and no route of the platform (OPEN_QUESTIONS 63)', () => {
  const css = toExportedFontCss(MIRRORED);
  assert.ok(!/gstatic|googleapis/.test(css));
  assert.ok(!css.includes('/ycode/api/fonts') && !css.includes(PUBLISHED_FONT_FILES_BASE), 'a static host has no platform behind it');
  assert.equal(css.split(`url(${EXPORTED_FONT_FILES_BASE}/ibmplexsansarabic/v15/`).length - 1, 3);
  assert.ok(css.includes('unicode-range: U+0600-06FF'), 'the rules are otherwise Google\'s own');
});

test('each file the sheet names is written into the export under the path its rule names', () => {
  const keys = mirroredFilePaths(MIRRORED).map(exportedFontKey);
  assert.deepEqual(keys, [
    'studio/fonts/ibmplexsansarabic/v15/Qw3CZRtWPQCuHme67tEYUIx3Kh0PHR9N6Ys43PW5fslBEg0.woff2',
    'studio/fonts/ibmplexsansarabic/v15/Qw3CZRtWPQCuHme67tEYUIx3Kh0PHR9N6Ys93PW5fslB.woff2',
  ]);
  const named = Array.from(toExportedFontCss(MIRRORED).matchAll(/url\(\/([^)]+)\)/g), (match) => match[1]);
  for (const key of keys) assert.ok(named.includes(key), `${key} is named by a rule`);
});
