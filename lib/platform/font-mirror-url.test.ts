import assert from 'node:assert/strict';
import { test } from 'node:test';

import { rewriteGoogleFontCss, toMirrorCssUrl } from './font-mirror-url';

test('a Google Fonts stylesheet URL becomes the app\'s mirror URL, other URLs are left alone', () => {
  assert.equal(
    toMirrorCssUrl('https://fonts.googleapis.com/css2?family=Inter:wght@400&display=swap'),
    '/ycode/api/fonts/mirror/css2?family=Inter:wght@400&display=swap',
  );
  assert.equal(toMirrorCssUrl('https://example.com/font.css'), 'https://example.com/font.css');
  assert.equal(toMirrorCssUrl('/fonts/a.css'), '/fonts/a.css');
});

test('every font file in the stylesheet points at the mirror', () => {
  const css = `@font-face { src: url(https://fonts.gstatic.com/s/inter/v20/a.woff2) format('woff2'); }
@font-face { src: url('https://fonts.gstatic.com/s/inter/v20/b.woff2') format('woff2'); }`;
  const out = rewriteGoogleFontCss(css);
  assert.ok(!out.includes('gstatic'));
  assert.ok(out.includes('url(/ycode/api/fonts/mirror/s/inter/v20/a.woff2)'));
  assert.ok(out.includes("url('/ycode/api/fonts/mirror/s/inter/v20/b.woff2')"));
});
