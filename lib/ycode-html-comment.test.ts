import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildYcodeHtmlComments,
  formatYcodePublishedCommentDate,
  insertYcodeHtmlComments,
} from '@/lib/ycode-html-comment';

test('formats the published date in Framer-style UTC', () => {
  const date = new Date('2026-09-04T10:49:00.000Z');
  assert.equal(formatYcodePublishedCommentDate(date), 'Sep 4, 2026, 10:49 AM UTC');
});

test('formats midnight and noon without a 0 hour', () => {
  assert.equal(
    formatYcodePublishedCommentDate(new Date('2026-01-01T00:05:00.000Z')),
    'Jan 1, 2026, 12:05 AM UTC',
  );
  assert.equal(
    formatYcodePublishedCommentDate(new Date('2026-12-31T12:00:00.000Z')),
    'Dec 31, 2026, 12:00 PM UTC',
  );
});

test('always emits the Made in Web Studio comment', () => {
  const html = buildYcodeHtmlComments();
  assert.equal(html, '<!-- Made in Web Studio -->');
});

test('adds a Published line when a timestamp is provided', () => {
  const html = buildYcodeHtmlComments('2026-09-04T10:49:00.000Z');
  assert.equal(
    html,
    '<!-- Made in Web Studio -->\n<!-- Published Sep 4, 2026, 10:49 AM UTC -->',
  );
});

test('ignores invalid published timestamps', () => {
  assert.equal(buildYcodeHtmlComments('not-a-date'), '<!-- Made in Web Studio -->');
});

test('inserts comments after doctype and before html', () => {
  const html = '<!DOCTYPE html><html lang="en"><head></head></html>';
  const stamped = insertYcodeHtmlComments(html, '2026-09-04T10:49:00.000Z');
  assert.equal(
    stamped,
    '<!DOCTYPE html>\n<!-- Made in Web Studio -->\n<!-- Published Sep 4, 2026, 10:49 AM UTC -->\n<html lang="en"><head></head></html>',
  );
});

test('normalizes a doctype that already has a newline', () => {
  const html = '<!DOCTYPE html>\n<html lang="en">\n<head></head>\n</html>\n';
  const stamped = insertYcodeHtmlComments(html, '2026-09-04T10:49:00.000Z');
  assert.equal(
    stamped,
    '<!DOCTYPE html>\n<!-- Made in Web Studio -->\n<!-- Published Sep 4, 2026, 10:49 AM UTC -->\n<html lang="en">\n<head></head>\n</html>\n',
  );
});

test('insert is idempotent', () => {
  const html = '<!DOCTYPE html><html><head></head></html>';
  const once = insertYcodeHtmlComments(html);
  assert.equal(insertYcodeHtmlComments(once), once);
});

test('inserts before html when doctype is missing', () => {
  const html = '<html><head></head></html>';
  const stamped = insertYcodeHtmlComments(html);
  assert.equal(
    stamped,
    '<!-- Made in Web Studio -->\n<html><head></head></html>',
  );
});
