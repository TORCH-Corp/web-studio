import assert from 'node:assert/strict';
import { test } from 'node:test';

import { queryRemixIcons } from './remix-icons';

test('the whole Remix set is there, split into fill and line', () => {
  const all = queryRemixIcons({ limit: 500 });
  assert.equal(all.totalIcons, 3229);
  assert.equal(all.total, 3229);
  assert.equal(queryRemixIcons({ style: 'fill' }).total + queryRemixIcons({ style: 'line' }).total, 3229);
  assert.equal(all.categories.reduce((sum, c) => sum + c.count, 0), 3229);
});

test('an icon carries standalone svg markup in currentColor', () => {
  const [icon] = queryRemixIcons({ search: 'arrow-down-box-line' }).icons;
  assert.equal(icon.name, 'arrow-down-box-line');
  assert.equal(icon.category, 'Arrows');
  assert.equal(icon.style, 'line');
  assert.match(icon.svg, /^<svg viewBox="0 0 24 24" fill="currentColor" xmlns="http:\/\/www\.w3\.org\/2000\/svg"><path d=".+"\/><\/svg>$/);
});

test('search needs every word, category and style narrow, limit and offset page', () => {
  const both = queryRemixIcons({ search: 'arrow down' });
  assert.ok(both.total > 0 && both.icons.every((i) => i.name.includes('arrow') && i.name.includes('down')));
  assert.equal(queryRemixIcons({ search: 'zzzz-no-such-icon' }).total, 0);
  assert.ok(queryRemixIcons({ category: 'Arrows' }).icons.every((i) => i.category === 'Arrows'));

  const first = queryRemixIcons({ limit: 3 });
  const second = queryRemixIcons({ limit: 3, offset: 3 });
  assert.equal(first.icons.length, 3);
  assert.notEqual(first.icons[0].name, second.icons[0].name);
  assert.equal(queryRemixIcons({ limit: 100000 }).limit, 500);
});
