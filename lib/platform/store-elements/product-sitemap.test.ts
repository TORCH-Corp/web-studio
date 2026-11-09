import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Locale, Page } from '@/types';
import { pagesForSitemap, productSitemapUrls } from './product-sitemap';

const BASE = 'https://shop.example.com';
const EN = { id: 'l-en', code: 'en', is_default: true } as Locale;
const AR = { id: 'l-ar', code: 'ar', is_default: false } as Locale;
const A = 'aaaaaaaa-0001-4000-8000-000000000001';
const B = 'aaaaaaaa-0002-4000-8000-000000000002';

const page = (id: string, settings: Page['settings'] = {}, extra: Partial<Page> = {}): Page =>
  ({ id, name: id, slug: id, is_index: false, is_dynamic: false, error_page: null, settings, created_at: '2026-11-01', ...extra }) as unknown as Page;

test('the page with the product role is left out of the sitemap: its bare address answers 404', () => {
  const home = page('home', {}, { is_index: true });
  const about = page('about');
  const products = page('products', { store: { kind: 'product' } });
  const cart = page('cart', { store: { kind: 'cart' } });
  assert.deepEqual(pagesForSitemap([home, about, products, cart]).map((p) => p.id), ['home', 'about', 'cart']);
  // A role on a page that cannot have one (a collection page) is no role: the page stays.
  const dynamic = page('collection', { store: { kind: 'product' } }, { is_dynamic: true });
  assert.deepEqual(pagesForSitemap([dynamic]).map((p) => p.id), ['collection']);
});

test('a product is listed at the product page\'s address and its id, once for a one-language site', () => {
  const urls = productSitemapUrls({ baseUrl: BASE, productIds: [A, B], paths: { '*': '/products' }, locales: [EN], changefreq: 'weekly' });
  assert.deepEqual(urls, [
    { loc: `${BASE}/products/${A}`, lastmod: undefined, changefreq: 'weekly' },
    { loc: `${BASE}/products/${B}`, lastmod: undefined, changefreq: 'weekly' },
  ]);
});

test('on a two-language site each product has one entry per language, each with the whole hreflang cluster', () => {
  const urls = productSitemapUrls({ baseUrl: BASE, productIds: [A], paths: { '*': '/products', ar: '/ar/products' }, locales: [AR, EN] });
  const alternates = [
    { hreflang: 'en', href: `${BASE}/products/${A}` },
    { hreflang: 'ar', href: `${BASE}/ar/products/${A}` },
    { hreflang: 'x-default', href: `${BASE}/products/${A}` },
  ];
  assert.deepEqual(urls.map((u) => u.loc), [`${BASE}/products/${A}`, `${BASE}/ar/products/${A}`]);
  for (const url of urls) assert.deepEqual(url.alternates, alternates);
});

test('a translated page address is followed, and a language with no stored path has the default path under its code', () => {
  const urls = productSitemapUrls({ baseUrl: BASE, productIds: [A], paths: { '*': '/products', ar: '/ar/منتجات' }, locales: [EN, AR] });
  // As ycode writes every other page's translated slug in this file: not percent-encoded.
  assert.equal(urls[1].loc, `${BASE}/ar/منتجات/${A}`);
  const added = productSitemapUrls({ baseUrl: BASE, productIds: [A], paths: { '*': '/products' }, locales: [EN, AR] });
  assert.equal(added[1].loc, `${BASE}/ar/products/${A}`);
});

test('no product page, no products and a trailing slash on the base give no surprises', () => {
  assert.deepEqual(productSitemapUrls({ baseUrl: BASE, productIds: [A], paths: undefined, locales: [EN] }), []);
  assert.deepEqual(productSitemapUrls({ baseUrl: BASE, productIds: [], paths: { '*': '/products' }, locales: [EN] }), []);
  assert.equal(productSitemapUrls({ baseUrl: `${BASE}/`, productIds: [A], paths: { '*': '/products' }, locales: [EN] })[0].loc, `${BASE}/products/${A}`);
});
