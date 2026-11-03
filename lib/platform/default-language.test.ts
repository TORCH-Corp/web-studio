import assert from 'node:assert/strict';
import { test } from 'node:test';

import { applySourceSwap, planSourceSwap, type SourceRows } from './default-language';

const AR = 'locale-ar';
const EN = 'locale-en';

const doc = (text: string) => ({ type: 'dynamic_rich_text', data: { content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] } } });
const textOf = (layer: any): string => layer.variables.text.data.content.content[0].content[0].text;

function rows(): SourceRows {
  return {
    pages: [
      { id: 'home', name: 'Home', slug: '', is_index: true, is_dynamic: false, error_page: null, settings: { seo: { title: 'الرئيسية', description: 'وصف' } } },
      { id: 'about', name: 'About', slug: 'man-nahnu', is_index: false, is_dynamic: false, error_page: null, settings: {} },
    ],
    pageLayers: [
      {
        id: 'layers-home',
        page_id: 'home',
        generated_css: '.x{}',
        layers: [{
          id: 'body', name: 'body', classes: '', children: [
            { id: 'title', name: 'heading', classes: '', children: [], variables: { text: doc('مرحبا') } },
            { id: 'same', name: 'text', classes: '', children: [], variables: { text: doc('0770 000 0000') } },
            { id: 'untranslated', name: 'text', classes: '', children: [], variables: { text: doc('بلا ترجمة') } },
            { id: 'draft', name: 'text', classes: '', children: [], variables: { text: doc('مسودة') } },
            { id: 'pic', name: 'image', classes: '', children: [], variables: { image: { src: { type: 'asset', data: { asset_id: 'asset-1' } }, alt: { type: 'dynamic_text', data: { content: 'صورة' } } } } },
          ],
        }],
      },
      { id: 'layers-about', page_id: 'about', generated_css: null, layers: [{ id: 'body', name: 'body', classes: '', children: [] }] },
    ],
    components: [{ id: 'cmp', name: 'Footer', layers: [{ id: 'cmp-root', name: 'div', classes: '', children: [{ id: 'cmp-text', name: 'text', classes: '', children: [], variables: { text: doc('حقوق') } }] }] }],
    folders: [],
    translations: [
      { id: 't-title', locale_id: EN, source_type: 'page', source_id: 'home', content_key: 'layer:title:text', content_type: 'text', content_value: 'Hello', is_completed: true, deleted_at: null },
      { id: 't-same', locale_id: EN, source_type: 'page', source_id: 'home', content_key: 'layer:same:text', content_type: 'text', content_value: '0770 000 0000', is_completed: true, deleted_at: null },
      { id: 't-draft', locale_id: EN, source_type: 'page', source_id: 'home', content_key: 'layer:draft:text', content_type: 'text', content_value: 'Draft', is_completed: false, deleted_at: null },
      { id: 't-alt', locale_id: EN, source_type: 'page', source_id: 'home', content_key: 'layer:pic:image_alt', content_type: 'text', content_value: 'Picture', is_completed: true, deleted_at: null },
      { id: 't-seo', locale_id: EN, source_type: 'page', source_id: 'home', content_key: 'seo:title', content_type: 'text', content_value: 'Home', is_completed: true, deleted_at: null },
      { id: 't-slug', locale_id: EN, source_type: 'page', source_id: 'about', content_key: 'slug', content_type: 'text', content_value: 'about', is_completed: true, deleted_at: null },
      { id: 't-cmp', locale_id: EN, source_type: 'component', source_id: 'cmp', content_key: 'layer:cmp-text:text', content_type: 'text', content_value: 'Rights', is_completed: true, deleted_at: null },
      { id: 't-override', locale_id: EN, source_type: 'page', source_id: 'home', content_key: 'layer:nowhere:override:text:v1', content_type: 'text', content_value: 'Orphan', is_completed: true, deleted_at: null },
      { id: 't-old-ar', locale_id: AR, source_type: 'page', source_id: 'home', content_key: 'layer:title:text', content_type: 'text', content_value: 'قديم', is_completed: false, deleted_at: '2026-11-01T00:00:00Z' },
    ],
  };
}

const children = (r: SourceRows, pageId: string) => ((r.pageLayers.find((l) => l.page_id === pageId)!.layers as any[])[0].children as any[]);

test('the new default\'s completed translations become the source, and the old source becomes its translations', () => {
  const r = rows();
  const plan = planSourceSwap(r, EN, true);
  applySourceSwap(r, plan, AR);

  const home = children(r, 'home');
  assert.equal(textOf(home.find((l) => l.id === 'title')), 'Hello');
  assert.equal(home.find((l) => l.id === 'pic').variables.image.alt.data.content, 'Picture');
  assert.equal(home.find((l) => l.id === 'pic').variables.image.src.data.asset_id, 'asset-1');
  assert.equal(textOf((r.components[0].layers as any[])[0].children[0]), 'Rights');
  assert.equal(r.pages.find((p) => p.id === 'about')!.slug, 'about');
  assert.deepEqual((r.pages.find((p) => p.id === 'home')!.settings as any).seo, { title: 'Home', description: 'وصف' });

  const arabic = Object.fromEntries(r.translations.filter((t) => t.locale_id === AR && !t.deleted_at).map((t) => [`${t.source_id}:${t.content_key}`, t.content_value]));
  assert.deepEqual(arabic, {
    'home:layer:title:text': 'مرحبا',
    'home:layer:same:text': '0770 000 0000',
    'home:layer:pic:image_alt': 'صورة',
    'home:seo:title': 'الرئيسية',
    'about:slug': 'man-nahnu',
    'cmp:layer:cmp-text:text': 'حقوق',
  });
  // The soft-deleted Arabic row of the same key is revived rather than duplicated.
  assert.equal(r.translations.filter((t) => t.locale_id === AR && t.content_key === 'layer:title:text').length, 1);
  assert.equal(r.translations.find((t) => t.id === 't-old-ar')!.is_completed, true);
});

test('what was not applied stays where it was: an incomplete translation, an untranslated text, a key the injector does not handle', () => {
  const r = rows();
  const plan = planSourceSwap(r, EN, true);
  assert.deepEqual(plan.moved.sort(), ['t-alt', 't-cmp', 't-same', 't-seo', 't-slug', 't-title']);
  applySourceSwap(r, plan, AR);

  const home = children(r, 'home');
  assert.equal(textOf(home.find((l) => l.id === 'draft')), 'مسودة');
  assert.equal(textOf(home.find((l) => l.id === 'untranslated')), 'بلا ترجمة');
  const english = r.translations.filter((t) => t.locale_id === EN).map((t) => t.id).sort();
  assert.deepEqual(english, ['t-draft', 't-override']);
});

test('when the old default leaves the site, nothing is written for it', () => {
  const r = rows();
  const plan = planSourceSwap(r, EN, false);
  assert.deepEqual(plan.movedOut, []);
  applySourceSwap(r, plan, AR);
  assert.equal(textOf(children(r, 'home').find((l) => l.id === 'title')), 'Hello');
  assert.equal(r.translations.filter((t) => t.locale_id === AR && !t.deleted_at).length, 0);
});

test('a language with no completed translations changes nothing', () => {
  const r = rows();
  r.translations = r.translations.filter((t) => t.id === 't-draft');
  const plan = planSourceSwap(r, EN, true);
  assert.equal(plan.moved.length + plan.movedOut.length + plan.pageLayers.size + plan.pages.size, 0);
});
