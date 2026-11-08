import assert from 'node:assert/strict';
import { test } from 'node:test';

import { STORE_COLOUR_DEFAULTS, storeColourStyle } from './colours';

test('the site\'s Primary, Primary soft and Dark are the store\'s colours, found by name whatever the case or spacing', () => {
  assert.deepEqual(
    storeColourStyle([
      { id: 'a1', name: 'Brand blue' },
      { id: 'b2', name: ' primary ' },
      { id: 'c3', name: 'PRIMARY   SOFT' },
      { id: 'd4', name: 'Dark' },
    ]),
    { '--ws-store-primary': 'var(--b2)', '--ws-store-primary-soft': 'var(--c3)', '--ws-store-dark': 'var(--d4)' },
  );
});

test('a colour the site does not have is left out, so the design system\'s default applies; the first of two with one name wins', () => {
  assert.deepEqual(storeColourStyle([{ id: 'x', name: 'Primary' }, { id: 'y', name: 'Primary' }]), { '--ws-store-primary': 'var(--x)' });
  assert.deepEqual(storeColourStyle([]), {});
  assert.deepEqual(storeColourStyle(null), {});
  assert.deepEqual(storeColourStyle([{ id: 'x', name: 'Primary colour' }]), {});
  assert.deepEqual(STORE_COLOUR_DEFAULTS, { '--ws-store-primary': '#0F766E', '--ws-store-primary-soft': '#E7F3F1', '--ws-store-dark': '#17201E' });
});
