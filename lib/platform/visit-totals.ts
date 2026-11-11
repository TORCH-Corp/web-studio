/**
 * The daily totals (part 3, session W8; PRD V1.0 "Visit counting" and
 * "Conversions report"): what one site's rows of one finished day become.
 *
 * Pure: the rows go in, the numbers come out. lib/platform/visit-totals-run.ts
 * reads a day's rows, calls `totalsOfDay` and stores the answer, so the unit
 * tests of this file are tests of the numbers the run writes.
 *
 * Which number each total holds:
 *
 * - `visitors` (site) and `visitors` (a page row): visitors with at least one
 *   counted view that day, each once, whatever the number of their views; for a
 *   page row, visitors of that page from that source on that device. A visitor
 *   who read two pages is one visitor of the day and one of each page; the same
 *   person on another day is another visitor (PRD).
 * - `views` (a page row): every counted view, so the same visitor reading the
 *   same page three times is three views and one visitor.
 * - `cartVisitors`: visitors who added to the cart, each once however many
 *   times they did (the event is also stored once per visitor and day).
 * - `orderVisitors` and `formVisitors`: visitors who placed an order, or sent a
 *   form, each once.
 * - `orders` and `forms`: the true number of Sales orders created and of forms
 *   stored (not spam): a visitor who orders twice is two orders.
 *
 * An event does not make its visitor a `visitor`: a visitor is someone whose
 * view was counted. An add to cart, an order or a form whose view was not
 * counted (the view was refused as too frequent, or it came before the salt was
 * set) is in its own column only, so a share of visitors can in principle pass
 * 100 %. The reports (session W9) clamp what they show to the data.
 *
 * Kept free of Next and database imports so it runs under `node --test`.
 */

import type { VisitDevice, VisitSource } from '@/lib/platform/visit-rules';

/** The detailed rows are kept this many days; the totals are kept with no limit (plan decision 20e). */
export const RETENTION_DAYS = 90;

/** The columns of a detailed row the totals read. `kind` is a string: a kind that is none of the four the table allows ('view', 'add_to_cart', 'order', 'form') is not counted. */
export interface TotalsRow {
  visitorKey: string;
  kind: string;
  /** The page's path; null for an event, which has no page. */
  path: string | null;
  source: VisitSource;
  device: VisitDevice;
}

/** One row of `platform_visit_days`: a page, from a source, on a device, for the day. */
export interface PageTotal {
  path: string;
  source: VisitSource;
  device: VisitDevice;
  views: number;
  visitors: number;
}

/** One row of `platform_visit_site_days`: the site's numbers for the day. */
export interface SiteTotal {
  visitors: number;
  cartVisitors: number;
  orderVisitors: number;
  orders: number;
  formVisitors: number;
  forms: number;
}

export interface DayTotals {
  /** Ordered by path, source, device. */
  pages: PageTotal[];
  site: SiteTotal;
}

const byText = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0);

/**
 * The totals of one site's rows of one day. The rows may come in any order and
 * may hold a kind more than once for a visitor; a view with no path is a fault
 * in the table (its check constraint forbids it) and throws.
 */
export function totalsOfDay(rows: readonly TotalsRow[]): DayTotals {
  const viewers = new Set<string>();
  const carts = new Set<string>();
  const orderers = new Set<string>();
  const writers = new Set<string>();
  let orders = 0;
  let forms = 0;
  const pages = new Map<string, { path: string; source: VisitSource; device: VisitDevice; views: number; visitors: Set<string> }>();

  for (const row of rows) {
    switch (row.kind) {
      case 'view': {
        if (row.path === null) throw new Error(`A view of visitor ${row.visitorKey.slice(0, 8)} has no path`);
        viewers.add(row.visitorKey);
        const key = JSON.stringify([row.path, row.source, row.device]);
        const page = pages.get(key) ?? { path: row.path, source: row.source, device: row.device, views: 0, visitors: new Set<string>() };
        page.views += 1;
        page.visitors.add(row.visitorKey);
        pages.set(key, page);
        break;
      }
      case 'add_to_cart':
        carts.add(row.visitorKey);
        break;
      case 'order':
        orders += 1;
        orderers.add(row.visitorKey);
        break;
      case 'form':
        forms += 1;
        writers.add(row.visitorKey);
        break;
      default:
        break; // a kind the totals do not know is not counted
    }
  }

  return {
    pages: [...pages.values()]
      .map(({ visitors, ...page }) => ({ ...page, visitors: visitors.size }))
      .sort((left, right) => byText(left.path, right.path) || byText(left.source, right.source) || byText(left.device, right.device)),
    site: { visitors: viewers.size, cartVisitors: carts.size, orderVisitors: orderers.size, orders, formVisitors: writers.size, forms },
  };
}
