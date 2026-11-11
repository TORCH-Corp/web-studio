import assert from 'node:assert/strict';
import { test } from 'node:test';

import { COPIED_TABLES, isSettingCopied, remapIds } from './template-copy';

const OLD_COMPONENT = '11111111-1111-4111-8111-111111111111';
const NEW_COMPONENT = '22222222-2222-4222-8222-222222222222';
const OLD_ASSET = '33333333-3333-4333-8333-333333333333';
const NEW_ASSET = '44444444-4444-4444-8444-444444444444';
const OLD_SITE = '55555555-5555-4555-8555-555555555555';
const NEW_SITE = '66666666-6666-4666-8666-666666666666';
const UNMAPPED = '77777777-7777-4777-8777-777777777777';

const map = new Map([
  [OLD_COMPONENT, NEW_COMPONENT],
  [OLD_ASSET, NEW_ASSET],
  [OLD_SITE, NEW_SITE],
]);

test('ids are remapped wherever they appear in a row: columns, layers json, variables, CSS, file URLs', () => {
  const row = {
    id: OLD_COMPONENT,
    page_folder_id: null,
    layers: [
      {
        id: 'lyr-abc',
        componentId: OLD_COMPONENT,
        variables: { image: { src: { type: 'asset', data: { asset_id: OLD_ASSET } } } },
        classes: `bg-[var(--${OLD_ASSET})] text-[var(--${UNMAPPED})]`,
        children: [{ id: 'lyr-def', styleIds: [OLD_COMPONENT, UNMAPPED] }],
      },
    ],
    thumbnail_url: `http://127.0.0.1:3002/platform-storage/${OLD_SITE}/assets/components/${OLD_COMPONENT}.webp`,
    order: 3,
    is_published: false,
  };

  assert.deepEqual(remapIds(row, map), {
    id: NEW_COMPONENT,
    page_folder_id: null,
    layers: [
      {
        id: 'lyr-abc',
        componentId: NEW_COMPONENT,
        variables: { image: { src: { type: 'asset', data: { asset_id: NEW_ASSET } } } },
        classes: `bg-[var(--${NEW_ASSET})] text-[var(--${UNMAPPED})]`,
        children: [{ id: 'lyr-def', styleIds: [NEW_COMPONENT, UNMAPPED] }],
      },
    ],
    thumbnail_url: `http://127.0.0.1:3002/platform-storage/${NEW_SITE}/assets/components/${NEW_COMPONENT}.webp`,
    order: 3,
    is_published: false,
  });
});

test('an id in upper case is recognised, and the input is not changed', () => {
  const row = { source_id: OLD_ASSET.toUpperCase(), content_key: 'layer:lyr-abc:text' };
  const out = remapIds(row, map);
  assert.equal(out.source_id, NEW_ASSET);
  assert.equal(out.content_key, 'layer:lyr-abc:text');
  assert.equal(row.source_id, OLD_ASSET.toUpperCase());
});

test('the settings left behind are the publish state, the site name, the site identity and the AI keys', () => {
  for (const key of ['published_at', 'published_css', 'site_name', 'global_canonical_url', 'google_site_verification', 'ga_measurement_id', 'ai_anthropic_api_key', 'ai_openai_api_key:1a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a']) {
    assert.equal(isSettingCopied(key), false, `${key} must not be copied`);
  }
  for (const key of ['timezone', 'ycode_badge', 'sitemap', 'favicon_asset_id', 'web_clip_asset_id', 'custom_code_head', 'draft_css', 'ai_model', 'ai_agent_enabled', 'redirects']) {
    assert.equal(isSettingCopied(key), true, `${key} must be copied`);
  }
});

test('the copied tables are the ones the plan names, the four collection tables since part 3 (session W11)', () => {
  assert.deepEqual(
    [...COPIED_TABLES].sort(),
    ['asset_folders', 'assets', 'collection_fields', 'collection_item_values', 'collection_items', 'collections', 'color_variables', 'components', 'fonts', 'global_variables', 'layer_styles', 'locales', 'page_folders', 'page_layers', 'pages', 'settings', 'translations'],
  );
});

test('a table is inserted after the table its foreign key names: collections, then their fields and items, then the values', () => {
  const at = (table: (typeof COPIED_TABLES)[number]) => COPIED_TABLES.indexOf(table);
  assert.ok(at('collections') < at('collection_fields'));
  assert.ok(at('collections') < at('collection_items'));
  assert.ok(at('collection_items') < at('collection_item_values'));
  assert.ok(at('collection_fields') < at('collection_item_values'));
  assert.ok(at('locales') < at('translations'));
});
