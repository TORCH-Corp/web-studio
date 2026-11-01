/**
 * Builds lib/platform/data/remix-icons.json from an unpacked `remixicon` npm
 * package (Remix Icon License v1.0). The builder serves this file from
 * /ycode/api/icons instead of calling ycode's hosted icons API.
 *
 *   npm pack remixicon && mkdir /tmp/remix && tar xzf remixicon-*.tgz -C /tmp/remix
 *   node scripts/build-remix-icons.mjs /tmp/remix/package
 *
 * Every Remix SVG is the same 24x24 `currentColor` wrapper around its paths,
 * so only the inner markup is stored; the wrapper is rebuilt on read.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { URL } from 'node:url';
import console from 'node:console';

const root = process.argv[2];
if (!root) throw new Error('Usage: node scripts/build-remix-icons.mjs <unpacked remixicon package>');

const WRAPPER = /^<svg viewBox="0 0 24 24" fill="currentColor" xmlns="http:\/\/www\.w3\.org\/2000\/svg">(.*)<\/svg>$/s;
const iconsDir = path.join(root, 'icons');
const out = [];

for (const category of fs.readdirSync(iconsDir).sort()) {
  for (const file of fs.readdirSync(path.join(iconsDir, category)).sort()) {
    if (!file.endsWith('.svg')) continue;
    const svg = fs.readFileSync(path.join(iconsDir, category, file), 'utf8').trim();
    const match = WRAPPER.exec(svg);
    if (!match) throw new Error(`${category}/${file} does not use the standard Remix wrapper`);
    out.push([file.slice(0, -4), category, match[1]]);
  }
}

const target = new URL('../lib/platform/data/remix-icons.json', import.meta.url);
fs.writeFileSync(target, JSON.stringify(out));
fs.copyFileSync(path.join(root, 'License'), new URL('../lib/platform/data/remix-icons.LICENSE', import.meta.url));
console.log(`${out.length} icons`);
