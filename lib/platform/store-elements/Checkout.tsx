'use client';

import React, { useCallback, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { checkoutBody, EMPTY_FORM, formErrors, type FormErrors, type FormField, type FormValues } from '@/lib/platform/store-elements/checkout-form';
import { getCartStore, type CartLine } from '@/lib/platform/store-elements/cart-store';
import { CheckoutView, type CheckoutBanner } from '@/lib/platform/store-elements/CheckoutView';
import { ConfirmationSkeleton } from '@/lib/platform/store-elements/ConfirmationView';
import { optionsText } from '@/lib/platform/store-elements/format';
import type { StoreLinks } from '@/lib/platform/store-elements/links';
import { summarise } from '@/lib/platform/store-elements/order-summary';
import OrderConfirmation from '@/lib/platform/store-elements/OrderConfirmation';
import { lineName, type LineView } from '@/lib/platform/store-elements/OrderLines';
import { postCheckout } from '@/lib/platform/store-elements/store-client';
import type { StoreLang } from '@/lib/platform/store-elements/strings';
import { useCartLines, useCartRefresh, useStoreTerms } from '@/lib/platform/store-elements/use-cart';

const NO_ERRORS: FormErrors = { fields: {}, general: [] };

type BannerKind = 'validation' | 'service' | 'rate_limited' | 'items';

/** A line as the item_unavailable alert names it: the route's name (the product and its options), else the cart's. */
function unavailableName(routeName: string | null, line: CartLine | undefined, lang: StoreLang): string {
  if (routeName) return routeName;
  if (!line) return '';
  return [lineName(line, lang), optionsText(line.snapshot.axes, lang)].filter(Boolean).join(' — ');
}

/**
 * The checkout element on a published page (PRD V1.1 "Cart and checkout"): the buyer's cart as an order summary,
 * the delivery form, the cash-on-delivery note and Place order.
 *
 * The checkout id is the cart's (cart-store.ts): made when the first order is sent and kept with the cart, so a
 * second click, a reload, or a try after the store could not be reached is the same checkout and makes one order.
 * The rules for the fields are the route's, shown under their fields. On success the cart is cleared and the buyer
 * goes to the confirmation page (`?order={checkout id}`); a site with no such page shows the order here.
 */
export default function Checkout({ lang, links }: { lang: StoreLang; links: StoreLinks }) {
  const { lines, ready } = useCartLines();
  const { state: terms, retry: retryTerms } = useStoreTerms();
  const refresh = useCartRefresh(ready && lines.length > 0);

  const [values, setValues] = useState<FormValues>(EMPTY_FORM);
  const [errors, setErrors] = useState<FormErrors>(NO_ERRORS);
  const [bannerKind, setBannerKind] = useState<BannerKind | null>(null);
  /** The items the route named as no longer available, by item id, with the name it gave. */
  const [refused, setRefused] = useState<ReadonlyMap<string, string>>(new Map());
  const [submitting, setSubmitting] = useState(false);
  /** The order exists: its checkout id, and whether the buyer is on their way to the confirmation page. */
  const [placed, setPlaced] = useState<{ checkoutId: string; leaving: boolean } | null>(null);
  const [stopped, setStopped] = useState(false);
  const sending = useRef(false);

  const onChange = useCallback((field: FormField, value: string) => {
    setValues((current) => ({ ...current, [field]: value }));
    // Typing in a field that was refused takes its message away: the buyer is correcting it.
    setErrors((current) => {
      if (current.fields[field] === undefined) return current;
      const { [field]: _gone, ...fields } = current.fields;
      return { ...current, fields };
    });
  }, []);

  /** Takes lines out of the cart, and out of what the route refused: an item added again later is a new line. */
  const removeLines = useCallback((itemIds: string[]) => {
    const cart = getCartStore();
    for (const itemId of itemIds) cart.remove(itemId);
    setRefused((current) => {
      const next = new Map(current);
      for (const itemId of itemIds) next.delete(itemId);
      return next.size === current.size ? current : next;
    });
  }, []);

  const submit = useCallback(async (honeypot = '') => {
    // One order on its way at a time: a second click, or Enter twice, before the first answer comes is this one.
    if (sending.current || terms.kind !== 'ok') return;
    const cart = getCartStore();
    const current = cart.lines();
    if (current.length === 0) return;
    sending.current = true;
    setSubmitting(true);
    setBannerKind(null);
    setErrors(NO_ERRORS);
    let stay = true;
    try {
      const result = await postCheckout(checkoutBody({ checkoutId: cart.checkoutId(), values, lines: current, lang, honeypot }));
      switch (result.kind) {
        case 'placed': {
          // The cart is over. The element shows where the buyer is going before it empties, so they never see an empty cart.
          const target = links.confirmation(result.checkout_id);
          flushSync(() => setPlaced({ checkoutId: result.checkout_id, leaving: target !== null }));
          cart.clear();
          if (target) window.location.assign(target);
          stay = false;
          return;
        }
        case 'invalid':
          setErrors(formErrors(result.fields));
          setBannerKind('validation');
          return;
        case 'item_unavailable':
          setRefused(new Map(result.items.map((item) => [item.item_id, unavailableName(item.name, current.find((line) => line.item_id === item.item_id), lang)])));
          setBannerKind('items');
          return;
        case 'rate_limited':
          setBannerKind('rate_limited');
          return;
        case 'not_selling':
          setStopped(true);
          return;
        case 'service_unavailable':
          setBannerKind('service');
          return;
      }
    } finally {
      if (stay) {
        sending.current = false;
        setSubmitting(false);
      }
    }
  }, [terms.kind, values, lang, links]);

  if (terms.kind === 'not_selling' || stopped) return null;
  if (placed) return placed.leaving ? <ConfirmationSkeleton lang={lang} /> : <OrderConfirmation
    lang={lang} links={links}
    checkoutId={placed.checkoutId}
                                                                             />;

  const summary = terms.kind === 'ok' ? summarise(lines, terms.terms) : null;
  // The items the store no longer sells: what the catalogue said when the page opened and what the route said at Place order.
  const unavailable = new Set([...refresh.report.unavailable, ...refused.keys()]);
  const views: LineView[] = lines.map((line) => ({
    line,
    href: links.product(line.product_id),
    total: summary?.kind === 'ready' ? (summary.lines.find((row) => row.line.item_id === line.item_id)?.total ?? null) : null,
    changedFrom: refresh.report.changed.get(line.item_id) ?? null,
    unavailable: unavailable.has(line.item_id),
  }));
  const unavailableCount = views.filter((view) => view.unavailable).length;
  const amounts = summary?.kind === 'ready' ? { subtotal: summary.subtotal, fee: summary.fee, total: summary.total } : null;

  const itemsStillInCart = lines.filter((line) => refused.has(line.item_id)).map((line) => refused.get(line.item_id) ?? '');
  const banner: CheckoutBanner | null =
    bannerKind === 'items' ? (itemsStillInCart.length > 0 ? { kind: 'items', names: itemsStillInCart } : null)
      : bannerKind === 'validation' ? (Object.keys(errors.fields).length + errors.general.length > 0 ? { kind: 'validation' } : null)
        : bannerKind === 'service' ? { kind: 'service' }
          : bannerKind === 'rate_limited' ? { kind: 'rate_limited' }
            : null;

  return (
    <CheckoutView
      lang={lang}
      links={links}
      phase={!ready || terms.kind === 'loading' ? 'loading' : terms.kind === 'error' ? 'error' : lines.length === 0 ? 'empty' : 'ready'}
      lines={views}
      count={lines.reduce((sum, line) => sum + line.quantity, 0)}
      summary={amounts}
      values={values}
      errors={errors}
      banner={banner}
      submitting={submitting}
      blocked={unavailableCount > 0 || amounts === null}
      unavailableCount={unavailableCount}
      onChange={onChange}
      onSubmit={submit}
      onRemove={(itemId) => removeLines([itemId])}
      onRemoveUnavailable={() => removeLines([...unavailable])}
      onRetry={retryTerms}
    />
  );
}
