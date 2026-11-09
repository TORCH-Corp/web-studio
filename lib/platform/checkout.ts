/**
 * A buyer's checkout becomes one Contact Center person and one Sales order,
 * once (part 2, session W3; PRD V1.1 "Cart and checkout", "Platform").
 *
 * One checkout, in this order:
 *   1. a checkout already stored for the site answers its order, calling
 *      nothing (the page keeps its checkout id until it succeeds);
 *   2. the lines are checked against the site's catalogue
 *      (lib/platform/checkout-rules.ts): 422 item_unavailable, nothing called;
 *   3. a USD store needs the day's USD→IQD rate, which Sales keeps on every USD
 *      order: none answers 503 before Contact Center (OPEN_QUESTIONS 30);
 *   4. it counts against the site's rate limit for the IP, once per checkout
 *      and phone, so a retry is not counted again (checkout-limit.ts);
 *   5. Contact Center finds or creates the buyer by the canonical phone;
 *   6. Sales creates the draft order, idempotent per checkout id; a refusal
 *      about items names them (422), anything else Sales refuses is the
 *      store's problem (503, logged);
 *   7. the order's id and code are stored in platform_storefront_orders.
 *
 * A failure at 5 or 6 stores nothing; a person made before Sales failed is
 * kept (a contact, not an order) and the retry finds it. Two requests with one
 * checkout id in this process share one flight; across processes Sales's
 * idempotency and the table's unique (site, checkout) keep it one order.
 *
 * Nothing about the buyer is stored or logged here: the name, the phone and
 * the address go to Contact Center and Sales only.
 */

import { RATE_LIMIT_WINDOW_MINUTES } from '@/lib/form-spam-settings';
import { getKnexClient } from '@/lib/knex-client';
import { siteCatalogue } from '@/lib/platform/catalogue';
import { forgetCatalogue } from '@/lib/platform/catalogue-cache';
import type { CheckoutInput } from '@/lib/platform/checkout-input';
import { checkoutCounter, countedCheckout, limitKey } from '@/lib/platform/checkout-limit';
import { confirmationOf, salesRefusalAnswer, unavailableLines, type Confirmation, type ProductName, type UnavailableLine } from '@/lib/platform/checkout-rules';
import { ContactCenterUnavailableError, findOrCreatePerson } from '@/lib/platform/contact-center';
import { OrgSetupUnavailableError, usdIqdRate } from '@/lib/platform/org-setup';
import { ProductServicesUnavailableError } from '@/lib/platform/product-services';
import { createStorefrontOrder, getOrder, SalesRefusedError, SalesUnavailableError, type SalesOrder } from '@/lib/platform/sales';
import type { Site } from '@/lib/platform/site';
import { rateDay } from '@/lib/platform/store-money';
import type { StoreRow } from '@/lib/platform/store-settings-input';

const TABLE = 'platform_storefront_orders';

export const RATE_LIMIT_WINDOW_MS = RATE_LIMIT_WINDOW_MINUTES * 60 * 1000;

export interface StoredCheckout {
  sales_order_id: string;
  sales_order_code: string;
}

export type CheckoutOutcome =
  /** `created`: this request made the order; false for a checkout answered from its record or from Sales's own. */
  | { kind: 'placed'; code: string; created: boolean }
  | { kind: 'item_unavailable'; items: UnavailableLine[] }
  | { kind: 'service_unavailable' };

/** The order a site's checkout became; null when it has none. */
export async function storedCheckout(siteId: string, checkoutId: string): Promise<StoredCheckout | null> {
  const knex = await getKnexClient();
  const row = (await knex(TABLE).where({ site_id: siteId, checkout_id: checkoutId }).first('sales_order_id', 'sales_order_code')) as StoredCheckout | undefined;
  return row ?? null;
}

/** Store the order of a checkout. A row stored meanwhile by another process wins: it names the same Sales order. */
async function recordCheckout(siteId: string, checkoutId: string, order: { id: string; code: string }): Promise<StoredCheckout> {
  const knex = await getKnexClient();
  await knex(TABLE)
    .insert({ site_id: siteId, checkout_id: checkoutId, sales_order_id: order.id, sales_order_code: order.code })
    .onConflict(['site_id', 'checkout_id'])
    .ignore();
  const stored = await storedCheckout(siteId, checkoutId);
  if (!stored) throw new Error(`The checkout ${checkoutId} of site ${siteId} was not stored`);
  if (stored.sales_order_id !== order.id) {
    console.error(`[checkout] site ${siteId} checkout ${checkoutId}: Sales answered order ${order.id}, the record holds ${stored.sales_order_id}`);
  }
  return stored;
}

/** Services a checkout calls; their failure answers 503 and stores nothing. */
function isUnavailable(error: unknown): error is Error {
  return (
    error instanceof ContactCenterUnavailableError ||
    error instanceof SalesUnavailableError ||
    error instanceof OrgSetupUnavailableError ||
    error instanceof ProductServicesUnavailableError
  );
}

async function place(site: Site, store: StoreRow, input: CheckoutInput, ip: string | null): Promise<CheckoutOutcome> {
  const stored = await storedCheckout(site.id, input.checkout_id);
  if (stored) return { kind: 'placed', code: stored.sales_order_code, created: false };

  const catalogue = await siteCatalogue(site);
  const refused = unavailableLines(catalogue, input.lines, input.locale);
  if (refused.length > 0) return { kind: 'item_unavailable', items: refused };

  const organizationId = site.organization_id;
  if (store.currency === 'USD') {
    const day = rateDay(new Date());
    if ((await usdIqdRate(organizationId, day)) === null) {
      console.warn(`[checkout] site ${site.id}: no USD→IQD rate for ${day} in Organization Setup; a USD store takes no order until there is one`);
      return { kind: 'service_unavailable' };
    }
  }
  if (!store.branch_id) throw new Error(`Site ${site.id} sells with no branch`);

  if (ip) checkoutCounter(RATE_LIMIT_WINDOW_MS).add(limitKey(site.id, ip), countedCheckout(input.checkout_id, input.buyer.phone_canonical), Date.now());

  const person = await findOrCreatePerson(organizationId, { name: input.buyer.name, phone: input.buyer.phone_canonical });
  let order: { id: string; code: string; created: boolean };
  try {
    order = await createStorefrontOrder(organizationId, {
      siteId: site.id,
      checkoutId: input.checkout_id,
      personId: person.personId,
      branchId: store.branch_id,
      currency: store.currency,
      lines: input.lines.map((line) => ({ itemId: line.item_id, quantity: line.quantity })),
      deliveryFee: store.delivery_fee,
      address: {
        city: input.buyer.city[input.locale],
        address: input.buyer.address,
        landmark: input.buyer.landmark,
        phone: input.buyer.phone,
      },
      notes: input.buyer.notes,
    });
  } catch (error) {
    if (!(error instanceof SalesRefusedError)) throw error;
    const answer = salesRefusalAnswer(error, input.lines, catalogue, input.locale);
    if (answer.kind === 'item_unavailable') {
      // The site's catalogue said otherwise a moment ago: its pages read it again.
      forgetCatalogue(site.id);
      return answer;
    }
    console.error(`[checkout] site ${site.id} checkout ${input.checkout_id}: ${answer.reason}: ${error.message}`);
    return { kind: 'service_unavailable' };
  }
  const recorded = await recordCheckout(site.id, input.checkout_id, order);
  return { kind: 'placed', code: recorded.sales_order_code, created: order.created };
}

const globalForFlights = globalThis as unknown as { __webStudioCheckoutFlights?: Map<string, Promise<CheckoutOutcome>> };
const flights = () => (globalForFlights.__webStudioCheckoutFlights ??= new Map());

/**
 * Place the order of a checkout. A second request for a checkout in flight
 * waits for the first and gets its outcome. A service that cannot be asked is
 * `service_unavailable`, logged; anything else is thrown.
 */
export async function placeOrder(site: Site, store: StoreRow, input: CheckoutInput, ip: string | null): Promise<CheckoutOutcome> {
  const key = `${site.id}:${input.checkout_id}`;
  const running = flights().get(key);
  if (running) return running;
  const flight = place(site, store, input, ip).catch((error: unknown): CheckoutOutcome => {
    if (!isUnavailable(error)) throw error;
    console.error(`[checkout] site ${site.id} checkout ${input.checkout_id}: ${error.message}`);
    return { kind: 'service_unavailable' };
  });
  flights().set(key, flight);
  try {
    return await flight;
  } finally {
    flights().delete(key);
  }
}

/**
 * The product of each variant line of an order, by the line's item id, from the
 * site's catalogue (read and kept 60 seconds as every page's read is; a
 * variant's product is the one that lists it, i.e. the variant's
 * parent_item_id). A variant whose product the catalogue no longer has is
 * absent: the confirmation then shows Sales's name for the line. An order with
 * no variant line never reads the catalogue. When the catalogue cannot be read
 * (Product & Services or Organization Setup down) the confirmation is still
 * answered, with Sales's names, and the failure is logged: the order exists and
 * its code must reach the buyer.
 */
async function productsOfVariantLines(site: Site, order: SalesOrder): Promise<Map<string, ProductName>> {
  const products = new Map<string, ProductName>();
  if (!order.lines.some((line) => line.axes.length > 0)) return products;
  let variantsById;
  try {
    variantsById = (await siteCatalogue(site)).variantsById;
  } catch (error) {
    if (!(error instanceof ProductServicesUnavailableError || error instanceof OrgSetupUnavailableError)) throw error;
    console.warn(`[checkout] site ${site.id} order ${order.code}: the catalogue could not be read, so the confirmation names variant lines as Sales does: ${error.message}`);
    return products;
  }
  for (const line of order.lines) {
    const parent = variantsById.get(line.itemId)?.product;
    if (parent) products.set(line.itemId, { name: parent.name, name_ar: parent.name_ar });
  }
  return products;
}

/**
 * The confirmation of a site's checkout, read from Sales (Web Studio keeps the
 * order's id and code only), a variant line with its product's name apart from
 * its options. Null when the site has no such checkout, or Sales no longer has
 * its order (logged). Throws SalesUnavailableError when Sales cannot be asked.
 */
export async function confirmation(site: Site, checkoutId: string): Promise<Confirmation | null> {
  const stored = await storedCheckout(site.id, checkoutId);
  if (!stored) return null;
  const order = await getOrder(site.organization_id, stored.sales_order_id);
  if (!order) {
    console.warn(`[checkout] site ${site.id} checkout ${checkoutId}: Sales has no order ${stored.sales_order_id}`);
    return null;
  }
  const products = await productsOfVariantLines(site, order);
  return confirmationOf(checkoutId, order, (itemId) => products.get(itemId) ?? null);
}
