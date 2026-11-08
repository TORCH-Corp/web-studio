import assert from 'node:assert/strict';
import { test } from 'node:test';

import { InvalidCursorError, SalesPermissionMissingError, SalesStatusRefusedError, SalesUnavailableError } from './sales';
import { orderErrorAnswer } from './orders-errors';

test('Sales saying the user lacks the flag is 403 sales_permission_missing, naming the flag the user needs', () => {
  assert.deepEqual(orderErrorAnswer(new SalesPermissionMissingError('sales.manage_orders x is missing')), {
    status: 403,
    body: { error: 'Sales does not let you confirm or cancel orders', code: 'sales_permission_missing', required: 'sales.manage_orders.x' },
  });
});

test('a rule of the order keeps Sales\'s status and code', () => {
  assert.deepEqual(orderErrorAnswer(new SalesStatusRefusedError(422, 'invalid_transition', 'Sales refused the status change: invalid_transition (A cancelled order takes no further status)')), {
    status: 422,
    body: { error: 'Sales refused the status change: invalid_transition (A cancelled order takes no further status)', code: 'invalid_transition' },
  });
  assert.equal(orderErrorAnswer(new SalesStatusRefusedError(409, 'order_invoiced', 'x'))?.status, 409);
  assert.equal(orderErrorAnswer(new SalesStatusRefusedError(403, 'not_a_storefront_order', 'x'))?.status, 403);
});

test('a bad cursor is 400 and Sales being out of reach is 503', () => {
  assert.deepEqual(orderErrorAnswer(new InvalidCursorError()), { status: 400, body: { error: 'The cursor is not valid', code: 'invalid_cursor' } });
  assert.deepEqual(orderErrorAnswer(new SalesUnavailableError('Sales answered 503')), { status: 503, body: { error: 'Sales could not be reached', code: 'sales_unavailable' } });
});

test('anything else is not this module\'s to answer', () => {
  assert.equal(orderErrorAnswer(new Error('Sales answered 400 to POST /internal/orders/{id}/status: body must NOT have additional properties')), null);
  assert.equal(orderErrorAnswer('text'), null);
  assert.equal(orderErrorAnswer(undefined), null);
});
