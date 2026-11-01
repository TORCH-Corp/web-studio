/**
 * Copies the browser scripts the builder and the published pages used to load
 * from jsDelivr into public/vendor/, at the versions in pnpm-lock.yaml
 * (part 1, session 3). The copies are committed; run this after bumping
 * @tailwindcss/browser, gsap, swiper or mapbox-gl:
 *
 *   node scripts/vendor-assets.mjs
 *
 * The trailing sourceMappingURL comment is dropped so a browser never asks for
 * a map file that is not there.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { URL } from 'node:url';
import console from 'node:console';

const require = createRequire(import.meta.url);
const target = new URL('../public/vendor/', import.meta.url);

const files = [
  ['@tailwindcss/browser', 'dist/index.global.js', 'tailwindcss-browser.js'],
  ['gsap', 'dist/gsap.min.js', 'gsap.min.js'],
  ['gsap', 'dist/SplitText.min.js', 'SplitText.min.js'],
  ['swiper', 'swiper-bundle.min.js', 'swiper-bundle.min.js'],
  ['mapbox-gl', 'dist/mapbox-gl.js', 'mapbox-gl.js'],
  ['mapbox-gl', 'dist/mapbox-gl.css', 'mapbox-gl.css'],
];

fs.mkdirSync(target, { recursive: true });
const versions = {};

for (const [pkg, file, name] of files) {
  const root = path.dirname(require.resolve(`${pkg}/package.json`));
  versions[pkg] = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
  const source = fs.readFileSync(path.join(root, file), 'utf8').replace(/\n?\/\/# sourceMappingURL=.*\s*$/, '\n');
  fs.writeFileSync(new URL(name, target), source);
}

fs.writeFileSync(new URL('VERSIONS.json', target), `${JSON.stringify(versions, null, 2)}\n`);
console.log(versions);
