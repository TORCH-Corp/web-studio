import assert from 'node:assert/strict';
import { test } from 'node:test';

import { storeFontFilePath, toStoreFontCss } from './fonts';

test('the stylesheet\'s files point at the anonymous route, nothing else changes', () => {
  const css = '@font-face{font-family:\'IBM Plex Sans Arabic\';src:url(/ycode/api/fonts/mirror/s/ibmplexsansarabic/v12/a.woff2) format(\'woff2\')}';
  assert.equal(
    toStoreFontCss(css),
    '@font-face{font-family:\'IBM Plex Sans Arabic\';src:url(/studio/api/store/font/files/ibmplexsansarabic/v12/a.woff2) format(\'woff2\')}',
  );
  assert.equal(toStoreFontCss('body{}'), 'body{}');
});

test('only a file of the IBM Plex Sans Arabic family is served without a session', () => {
  assert.equal(storeFontFilePath(['ibmplexsansarabic', 'v12', 'a.woff2']), 's/ibmplexsansarabic/v12/a.woff2');
  assert.equal(storeFontFilePath(['inter', 'v18', 'a.woff2']), null);
  assert.equal(storeFontFilePath(['ibmplexsansarabic']), null);
  assert.equal(storeFontFilePath([]), null);
  assert.equal(storeFontFilePath(['IBMPlexSansArabic', 'v12', 'a.woff2']), null);
});
