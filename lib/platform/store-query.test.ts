import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseProductsQuery } from './store-query';

const parse = (query: string) => parseProductsQuery(new URLSearchParams(query));
const CATEGORY = '25252525-0001-4525-8525-252525252525';

test('no query is the first page of twelve, everything', () => {
  assert.deepEqual(parse(''), { query: { category: null, search: null, page: 1, pageSize: 12 } });
});

test('a category, a search and a page are read as the grid sends them', () => {
  assert.deepEqual(parse(`category=${CATEGORY.toUpperCase()}&q=%20lamp%20&page=3&page_size=48`), {
    query: { category: CATEGORY, search: 'lamp', page: 3, pageSize: 48 },
  });
  assert.deepEqual(parse('q=%20%20'), { query: { category: null, search: null, page: 1, pageSize: 12 } });
});

test('a page size above 48, a page below 1, a category that is not an id, an unknown or repeated key are refused, each named', () => {
  assert.deepEqual(parse('page_size=49'), { errors: ['page_size must be a whole number from 1 to 48'] });
  assert.deepEqual(parse('page=0'), { errors: ['page must be a whole number from 1 to 1000000'] });
  assert.deepEqual(parse('page=1.5'), { errors: ['page must be a whole number from 1 to 1000000'] });
  assert.deepEqual(parse('category=shirts'), { errors: ['category must be a category id'] });
  assert.deepEqual(parse('sort=price'), { errors: ['sort is not a filter of the products list'] });
  assert.deepEqual(parse('page=1&page=2'), { errors: ['page is given more than once'] });
  assert.deepEqual(parse(`q=${'x'.repeat(201)}`), { errors: ['q must be 200 characters at most'] });
});

const OTHER = '25252525-0002-4525-8525-252525252525';

test('several categories are read as a list, repeated ids once, in any case', () => {
  assert.deepEqual(parse(`categories=${CATEGORY},${OTHER.toUpperCase()},${CATEGORY}&page_size=4`), {
    query: { category: null, categories: [CATEGORY, OTHER], search: null, page: 1, pageSize: 4 },
  });
});

test('categories is refused when empty, not made of ids, longer than 24, or given with category', () => {
  const message = 'categories must be 1 to 24 category ids separated by commas';
  assert.deepEqual(parse('categories='), { errors: [message] });
  assert.deepEqual(parse(`categories=${CATEGORY},shirts`), { errors: [message] });
  assert.deepEqual(parse(`categories=${CATEGORY},`), { errors: [message] });
  const many = Array.from({ length: 25 }, (_, i) => `25252525-00${String(i).padStart(2, '0')}-4525-8525-252525252525`).join(',');
  assert.deepEqual(parse(`categories=${many}`), { errors: [message] });
  assert.deepEqual(parse(`category=${CATEGORY}&categories=${OTHER}`), { errors: ['give category or categories, not both'] });
});
