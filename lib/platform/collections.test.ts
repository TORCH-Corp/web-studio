import assert from 'node:assert/strict';
import { test } from 'node:test';

import { builderPathOfCollection, collectionRow, type CollectionRecord } from './collections';

const ID = '5a5a5a5a-5a5a-4a5a-8a5a-5a5a5a5a5a5a';
const record = (over: Partial<CollectionRecord> = {}): CollectionRecord => ({
  id: ID,
  name: 'Blog',
  created_at: new Date('2026-11-01T08:00:00.000Z'),
  updated_at: new Date('2026-11-02T08:00:00.000Z'),
  item_count: '3',
  items_changed_at: new Date('2026-11-05T08:00:00.000Z'),
  ...over,
});

test('the builder path is the builder\'s own route for the collection', () => {
  assert.equal(builderPathOfCollection(ID), `/ycode/collections/${ID}`);
  assert.equal(collectionRow(record()).builder_path, `/ycode/collections/${ID}`);
});

test('the row carries the id, the name and the count as a number (the database sends a count as a string)', () => {
  assert.deepEqual(collectionRow(record()), {
    id: ID,
    name: 'Blog',
    item_count: 3,
    last_change: '2026-11-05T08:00:00.000Z',
    builder_path: `/ycode/collections/${ID}`,
  });
  assert.equal(collectionRow(record({ item_count: 0 })).item_count, 0);
  assert.equal(collectionRow(record({ item_count: '12' })).item_count, 12);
});

test('the last change is the later of the collection\'s date and its items\'', () => {
  // An item edited after the collection: the item's date.
  assert.equal(collectionRow(record()).last_change, '2026-11-05T08:00:00.000Z');
  // The collection renamed after its items were edited: the collection's own date.
  assert.equal(collectionRow(record({ updated_at: new Date('2026-11-09T08:00:00.000Z') })).last_change, '2026-11-09T08:00:00.000Z');
  // No items: the collection's date.
  assert.equal(collectionRow(record({ items_changed_at: null, item_count: 0 })).last_change, '2026-11-02T08:00:00.000Z');
});

test('dates come as Date or as text, and the answer is always an ISO date', () => {
  const row = collectionRow(record({ updated_at: '2026-11-02T08:00:00+03:00', items_changed_at: '2026-11-03T08:00:00.000Z' }));
  assert.equal(row.last_change, '2026-11-03T08:00:00.000Z');
  assert.equal(collectionRow(record({ updated_at: '2026-11-10T08:00:00+03:00', items_changed_at: null })).last_change, '2026-11-10T05:00:00.000Z');
});

test('a collection with no updated_at falls back to when it was made; with no date at all it is an error, not an invented one', () => {
  assert.equal(collectionRow(record({ updated_at: null, items_changed_at: null })).last_change, '2026-11-01T08:00:00.000Z');
  assert.throws(() => collectionRow(record({ created_at: null, updated_at: null, items_changed_at: null })), /no date/);
});
