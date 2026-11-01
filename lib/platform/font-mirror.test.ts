import assert from 'node:assert/strict';
import { test } from 'node:test';

import { getMirroredCss, getMirroredFontFile, MirrorRequestError } from './font-mirror';

test('a font path with a dot segment, outside s/, or not a font file is refused before any read or fetch', async () => {
  for (const filePath of [
    's/inter/../../../../../../etc/fonts/x.ttf',
    's/inter/v18/../x.woff2',
    's/./x.woff2',
    's/inter/.hidden/x.woff2',
    'inter/v18/x.woff2',
    's/inter/v18/x.exe',
    's/inter/v18/x.woff2/',
    '',
  ]) {
    await assert.rejects(getMirroredFontFile(filePath), MirrorRequestError, filePath);
  }
});

test('a css2 query is refused when it carries anything but Google Fonts query characters', async () => {
  for (const query of ['family=<script>', 'family=Inter&x=/../', '', 'a'.repeat(4001)]) {
    await assert.rejects(getMirroredCss(query), MirrorRequestError, query);
  }
});
