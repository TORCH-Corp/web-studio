/**
 * What the Orders API answers when Sales refuses or cannot be reached (part 2,
 * session W8). Pure, so it runs under `node --test`.
 *
 * Sales's 403 `permission_missing` becomes 403 `{ code: 'sales_permission_missing' }`
 * so the app can say which flag the user lacks: the Web Studio flag is the
 * proxy's 403 (`required: 'webstudio.manage_orders.x'`), this one is Sales's.
 * A rule of the order (a status the order cannot move to, an issued invoice)
 * keeps Sales's status and code. A 400 from Sales is a contract mismatch and is
 * not answered here: the route lets it become a logged 500.
 */

import { InvalidCursorError, SalesPermissionMissingError, SalesStatusRefusedError, SalesUnavailableError } from './sales';

export interface OrderErrorAnswer {
  status: 400 | 403 | 409 | 422 | 503;
  body: { error: string; code: string; required?: string };
}

/** The answer for an error the Orders API knows; null for any other, which the route logs and answers 500. */
export function orderErrorAnswer(error: unknown): OrderErrorAnswer | null {
  if (error instanceof SalesPermissionMissingError) {
    return { status: 403, body: { error: 'Sales does not let you confirm or cancel orders', code: 'sales_permission_missing', required: 'sales.manage_orders.x' } };
  }
  if (error instanceof SalesStatusRefusedError) return { status: error.httpStatus, body: { error: error.message, code: error.code } };
  if (error instanceof InvalidCursorError) return { status: 400, body: { error: 'The cursor is not valid', code: 'invalid_cursor' } };
  if (error instanceof SalesUnavailableError) return { status: 503, body: { error: 'Sales could not be reached', code: 'sales_unavailable' } };
  return null;
}
