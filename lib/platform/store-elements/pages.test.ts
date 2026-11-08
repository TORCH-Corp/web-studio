import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Locale, Page, PageFolder, Translation } from '@/types';
import {
  canHaveStoreRole,
  computeStorePagePaths,
  isStorePageRequest,
  matchProductPage,
  pageForRole,
  parseStorePagePaths,
  pathFor,
  samePaths,
  storeKindOf,
  storePageTaken,
} from './pages';

const ITEM = '48484848-0003-4848-8848-484848484848';

let counter = 0;
function page(over: Partial<Page> & { store?: unknown } = {}): Page {
  const { store, ...rest } = over;
  counter += 1;
  return {
    id: `page-${counter}`,
    slug: `page-${counter}`,
    name: `Page ${counter}`,
    page_folder_id: null,
    order: counter,
    depth: 0,
    is_index: false,
    is_dynamic: false,
    error_page: null,
    settings: store === undefined ? {} : ({ store } as Page['settings']),
    is_published: true,
    is_publishable: true,
    created_at: `2026-11-0${(counter % 9) + 1}T10:00:00Z`,
    updated_at: '2026-11-08T10:00:00Z',
    deleted_at: null,
    ...rest,
  } as Page;
}

const folder = (id: string, slug: string, parent: string | null = null): PageFolder => ({ id, slug, page_folder_id: parent }) as PageFolder;
const locale = (code: string, is_default = false): Locale => ({ id: `loc-${code}`, code, label: code, is_default, is_published: true }) as Locale;
const slugTranslation = (sourceId: string, type: 'page' | 'folder', value: string): [string, Translation] => [
  `${type}:${sourceId}:slug`,
  { source_type: type, source_id: sourceId, content_key: 'slug', content_value: value } as Translation,
];

test('a page\'s store role is what its settings say, and nothing else is a role', () => {
  assert.equal(storeKindOf(page({ store: { kind: 'product' } })), 'product');
  assert.equal(storeKindOf(page({ store: { kind: 'cart' } })), 'cart');
  assert.equal(storeKindOf(page()), null);
  assert.equal(storeKindOf(page({ store: { kind: 'wishlist' } })), null);
  assert.equal(storeKindOf(page({ store: 'product' })), null);
  assert.equal(storeKindOf(null), null);
});

test('only an ordinary page can have a role: not a collection page, an index page or an error page', () => {
  assert.equal(canHaveStoreRole(page()), true);
  assert.equal(canHaveStoreRole(page({ is_dynamic: true })), false);
  assert.equal(canHaveStoreRole(page({ is_index: true })), false);
  assert.equal(canHaveStoreRole(page({ error_page: 404 })), false);
});

test('the page with a role is the earliest one that can have it, so two never disagree', () => {
  const later = page({ slug: 'later', store: { kind: 'product' }, created_at: '2026-11-05T10:00:00Z' });
  const earlier = page({ slug: 'earlier', store: { kind: 'product' }, created_at: '2026-11-02T10:00:00Z' });
  const index = page({ slug: '', is_index: true, store: { kind: 'product' }, created_at: '2026-11-01T10:00:00Z' });
  assert.equal(pageForRole([later, index, earlier], 'product')?.slug, 'earlier');
  assert.equal(pageForRole([later, earlier], 'cart'), null);
});

test('the panel can tell which other page already has a role', () => {
  const taken = page({ store: { kind: 'product' } });
  const me = page({ store: { kind: 'product' } });
  assert.equal(storePageTaken([taken, me], 'product', me.id)?.id, taken.id);
  assert.equal(storePageTaken([me], 'product', me.id), null);
  assert.equal(storePageTaken([taken], 'cart', null), null);
});

test('the path of each role is written per language: the default, and each other language with its prefix and translated slugs', () => {
  const shop = folder('f-shop', 'shop');
  const product = page({ id: 'p-prod', slug: 'product', page_folder_id: 'f-shop', store: { kind: 'product' } });
  const paths = computeStorePagePaths({
    pages: [product, page({ slug: 'about' })],
    folders: [shop],
    locales: [locale('en', true), locale('ar'), locale('fr')],
    translationsFor: (code) => (code === 'ar' ? Object.fromEntries([slugTranslation('f-shop', 'folder', 'متجر'), slugTranslation('p-prod', 'page', 'منتج')]) : undefined),
  });
  assert.deepEqual(paths, { product: { '*': '/shop/product', ar: '/ar/متجر/منتج', fr: '/fr/shop/product' } });
});

test('a site with no languages still has the default path; a role nobody has is not written', () => {
  const paths = computeStorePagePaths({ pages: [page({ slug: 'product', store: { kind: 'product' } })], folders: [], locales: [], translationsFor: () => undefined });
  assert.deepEqual(paths, { product: { '*': '/product' } });
  assert.deepEqual(computeStorePagePaths({ pages: [page()], folders: [], locales: [locale('en', true)], translationsFor: () => undefined }), {});
});

test('the written paths are read back defensively: anything that is not a path map is no path', () => {
  assert.deepEqual(parseStorePagePaths({ product: { '*': '/product', ar: '/ar/product' } }), { product: { '*': '/product', ar: '/ar/product' } });
  assert.deepEqual(parseStorePagePaths(null), {});
  assert.deepEqual(parseStorePagePaths('x'), {});
  assert.deepEqual(parseStorePagePaths({ product: 'nope', cart: { '*': 3, ar: 'no-slash' }, other: { '*': '/x' } }), {});
});

test('a link goes to the role\'s page in the page\'s own language; the default language\'s when that language has none; null when there is no page', () => {
  const paths = { product: { '*': '/product', ar: '/ar/منتج' } };
  assert.equal(pathFor(paths, 'product', null), '/product');
  assert.equal(pathFor(paths, 'product', { code: 'en', is_default: true }), '/product');
  assert.equal(pathFor(paths, 'product', { code: 'ar', is_default: false }), '/ar/منتج');
  assert.equal(pathFor(paths, 'product', { code: 'fr', is_default: false }), '/fr/product', 'a language written after the last publish keeps its prefix');
  assert.equal(pathFor(paths, 'cart', null), null);
  assert.equal(pathFor({}, 'product', null), null);
});

test('a request is for the product page when it is the page\'s path, or that path and one more segment (the item), in any language', () => {
  const paths = { product: { '*': '/product', ar: '/ar/منتج' } };
  assert.equal(isStorePageRequest(`product/${ITEM}`, paths), true);
  assert.equal(isStorePageRequest(`ar/منتج/${ITEM}`, paths), true);
  assert.equal(isStorePageRequest(`ar/%D9%85%D9%86%D8%AA%D8%AC/${ITEM}`, paths), true, 'as the address arrives, percent-encoded');
  assert.equal(isStorePageRequest('product', paths), true, 'the page itself, with no item');
  assert.equal(isStorePageRequest(`product/${ITEM}/extra`, paths), false);
  assert.equal(isStorePageRequest(`products/${ITEM}`, paths), false);
  assert.equal(isStorePageRequest('productive', paths), false);
  assert.equal(isStorePageRequest(`product/${ITEM}`, {}), false);
});

test('the cart, checkout and confirmation pages are live requests at their own paths only, in any language', () => {
  const paths = { cart: { '*': '/cart', ar: '/ar/السلة' }, checkout: { '*': '/checkout' }, confirmation: { '*': '/thanks' } };
  for (const path of ['cart', 'ar/السلة', 'ar/%D8%A7%D9%84%D8%B3%D9%84%D8%A9', 'checkout', 'thanks', 'thanks/']) assert.equal(isStorePageRequest(path, paths), true, path);
  assert.equal(isStorePageRequest(`cart/${ITEM}`, paths), false, 'only the product page takes an item');
  assert.equal(isStorePageRequest('carts', paths), false);
  assert.equal(isStorePageRequest('about', paths), false);
  assert.equal(isStorePageRequest('thanks', { cart: paths.cart }), false, 'no page has that role');
});

test('the product page answers at its path and the item id', () => {
  const product = page({ slug: 'products', store: { kind: 'product' } });
  const other = page({ slug: 'about' });
  const hit = matchProductPage({ targetPath: `products/${ITEM.toUpperCase()}`, pages: [other, product], folders: [], translations: undefined });
  assert.equal(hit?.page.id, product.id);
  assert.equal(hit?.itemId, ITEM, 'an id in capitals is the same id');
});

test('what is not the product page\'s path and an item is no product page', () => {
  const product = page({ slug: 'products', store: { kind: 'product' } });
  const match = (targetPath: string) => matchProductPage({ targetPath, pages: [product], folders: [], translations: undefined });
  assert.equal(match('products'), null, 'no item');
  assert.equal(match(`products/${ITEM}/more`), null);
  assert.equal(match(`shop/${ITEM}`), null);
  assert.equal(match(''), null);
  assert.equal(matchProductPage({ targetPath: `about/${ITEM}`, pages: [page({ slug: 'about' })], folders: [], translations: undefined }), null, 'a page without the role');
});

test('an id that is not an item id still reaches the page (it is the "no longer on sale" state), carrying what was asked', () => {
  const product = page({ slug: 'products', store: { kind: 'product' } });
  const hit = matchProductPage({ targetPath: 'products/not-an-item', pages: [product], folders: [], translations: undefined });
  assert.equal(hit?.page.id, product.id);
  assert.equal(hit?.itemId, null);
});

test('the page is found by its folder and its translated slugs in another language', () => {
  const shop = folder('f-shop', 'shop');
  const product = page({ id: 'p-prod', slug: 'product', page_folder_id: 'f-shop', store: { kind: 'product' } });
  const translations = Object.fromEntries([slugTranslation('f-shop', 'folder', 'متجر'), slugTranslation('p-prod', 'page', 'منتج')]);
  assert.equal(matchProductPage({ targetPath: `shop/product/${ITEM}`, pages: [product], folders: [shop], translations: undefined })?.page.id, 'p-prod');
  assert.equal(matchProductPage({ targetPath: `متجر/منتج/${ITEM}`, pages: [product], folders: [shop], translations })?.page.id, 'p-prod');
  assert.equal(matchProductPage({ targetPath: `shop/product/${ITEM}`, pages: [product], folders: [shop], translations }), null, 'the English slugs are not Arabic\'s');
});

test('two sets of paths are the same whatever order their keys came in, and differ in a path, a language or a role', () => {
  const a = { product: { '*': '/product', ar: '/ar/منتج' }, cart: { '*': '/cart' } };
  assert.equal(samePaths(a, { cart: { '*': '/cart' }, product: { ar: '/ar/منتج', '*': '/product' } }), true);
  assert.equal(samePaths({}, {}), true);
  assert.equal(samePaths(a, { ...a, cart: { '*': '/basket' } }), false);
  assert.equal(samePaths(a, { product: a.product }), false);
  assert.equal(samePaths(a, { ...a, product: { '*': '/product' } }), false);
});
