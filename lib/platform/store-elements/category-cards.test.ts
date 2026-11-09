import assert from 'node:assert/strict';
import { test } from 'node:test';

import { categoryCardsOf } from './category-cards';

const summary = (id: string, item_count: number, first_product_image: string | null) => ({ id, name: `Name ${id}`, name_ar: `اسم ${id}`, item_count, first_product_image });

test('a category card has the category\'s names and its first product\'s picture, in the list\'s order (OPEN_QUESTIONS 8 and 55)', () => {
  assert.deepEqual(categoryCardsOf([summary('b', 2, '/store-media/doc-1?item=p1'), summary('a', 1, null)]), [
    { id: 'b', name: 'Name b', name_ar: 'اسم b', imageUrl: '/store-media/doc-1?item=p1' },
    { id: 'a', name: 'Name a', name_ar: 'اسم a', imageUrl: null },
  ]);
});

test('a category the site sells nothing in has no card', () => {
  assert.deepEqual(categoryCardsOf([summary('empty', 0, null), summary('full', 3, null)]).map((card) => card.id), ['full']);
  assert.deepEqual(categoryCardsOf([summary('empty', 0, null)]), []);
  assert.deepEqual(categoryCardsOf([]), []);
});
