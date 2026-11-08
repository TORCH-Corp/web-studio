'use client';

import React, { useState } from 'react';
import clsx from 'clsx';
import { AlertIcon, ArrowBackIcon, BagIcon, MinusIcon, PlusIcon, RetryIcon, TrashIcon } from '@/lib/platform/store-elements/icons';
import { CardMedia } from '@/lib/platform/store-elements/CardView';
import { MAX_LINE_QUANTITY } from '@/lib/platform/store-elements/cart-store';
import { moneyText, optionsText, unitText } from '@/lib/platform/store-elements/format';
import type { StoreLinks } from '@/lib/platform/store-elements/links';
import type { Money } from '@/lib/platform/store-elements/order-summary';
import { LineTags, lineName, SumRows, type LineView } from '@/lib/platform/store-elements/OrderLines';
import { STORE_STRINGS, type StoreLang } from '@/lib/platform/store-elements/strings';

export interface CartViewProps {
  lang: StoreLang;
  links: StoreLinks;
  /**
   * `loading`: the cart and the store's settings are being read; `error`: the settings could not be read; `empty`;
   * `ready`: lines and, once the amounts are known, a summary.
   */
  phase: 'loading' | 'error' | 'empty' | 'ready';
  lines: LineView[];
  /** The pieces in the cart. */
  count: number;
  /** Null while an amount cannot be shown yet. */
  summary: { subtotal: Money; fee: Money; total: Money } | null;
  /** The prices could not be checked against the catalogue. */
  pricesNotChecked: boolean;
  /** Checkout is off: a line is unavailable, or the amounts are not known yet. */
  blocked: boolean;
  unavailableCount: number;
  onQuantity: (itemId: string, quantity: number) => void;
  onRemove: (itemId: string) => void;
  onRetry: () => void;
  onRetryPrices: () => void;
}

/** The quantity stepper of a cart line (handoff `stepper-sm`): minus, the number (which can be typed), plus. */
function LineStepper({ itemId, name, quantity, lang, onQuantity }: { itemId: string; name: string; quantity: number; lang: StoreLang; onQuantity: (itemId: string, quantity: number) => void }) {
  const t = STORE_STRINGS[lang];
  // What the buyer has typed so far, which may not be a number yet. It belongs to the quantity it was typed over: when
  // the cart's quantity changes by any other way (the buttons, another tab) the line shows the cart's.
  const [draft, setDraft] = useState<{ over: number; text: string } | null>(null);
  const text = draft && draft.over === quantity ? draft.text : String(quantity);

  const commit = () => {
    const typed = Math.round(Number(text));
    const next = Number.isFinite(typed) && typed >= 1 ? Math.min(MAX_LINE_QUANTITY, typed) : quantity;
    setDraft(null);
    if (next !== quantity) onQuantity(itemId, next);
  };

  return (
    <div
      className="ws-stepper ws-stepper-sm" role="group"
      aria-label={t.quantityOf(name)}
    >
      <button
        className="ws-step-btn" type="button"
        aria-label={t.decreaseQuantity} disabled={quantity <= 1}
        onClick={() => onQuantity(itemId, quantity - 1)}
      ><MinusIcon /></button>
      <input
        className="ws-step-val" type="text"
        inputMode="numeric" value={text}
        aria-label={t.quantity}
        onChange={(event) => setDraft({ over: quantity, text: event.target.value.replace(/[^0-9]/g, '').slice(0, 3) })}
        onBlur={commit}
        onKeyDown={(event) => event.key === 'Enter' && commit()}
      />
      <button
        className="ws-step-btn" type="button"
        aria-label={t.increaseQuantity} disabled={quantity >= MAX_LINE_QUANTITY}
        onClick={() => onQuantity(itemId, quantity + 1)}
      ><PlusIcon /></button>
    </div>
  );
}

function CartLineItem({ view, lang, onQuantity, onRemove }: { view: LineView; lang: StoreLang; onQuantity: CartViewProps['onQuantity']; onRemove: CartViewProps['onRemove'] }) {
  const t = STORE_STRINGS[lang];
  const { line } = view;
  const name = lineName(line, lang);
  const options = optionsText(line.snapshot.axes, lang);
  return (
    <li className={clsx('ws-line', view.unavailable && 'ws-line-off')} data-item-id={line.item_id}>
      <a
        className="ws-line-thumb" href={view.href}
        tabIndex={-1} aria-hidden="true"
      >
        <CardMedia url={line.snapshot.image} label={t.productImage} />
      </a>
      <div className="ws-line-body">
        <a className="ws-line-name" href={view.href}>{name}</a>
        {options && <p className="ws-line-opts">{options}</p>}
        <p className="ws-line-unit">{t.pricePerUnit(moneyText(line.snapshot.price, lang), unitText(line.snapshot.unit))}</p>
        <LineTags view={view} lang={lang} />
      </div>
      <div className="ws-line-actions">
        {!view.unavailable && <LineStepper
          itemId={line.item_id} name={name}
          quantity={line.quantity} lang={lang}
          onQuantity={onQuantity}
                              />}
        {!view.unavailable && view.total && <p className="ws-line-total">{moneyText(view.total, lang)}</p>}
        <button
          className="ws-remove" type="button"
          aria-label={t.removeLine(name)} onClick={() => onRemove(line.item_id)}
        >
          <TrashIcon />
          <span aria-hidden="true">{t.remove}</span>
        </button>
      </div>
    </li>
  );
}

/** The cart's skeleton while it is read: three lines and the summary as grey blocks. */
export function CartSkeleton({ lang }: { lang: StoreLang }) {
  const t = STORE_STRINGS[lang];
  return (
    <div className="ws-cart-page" aria-busy="true">
      <p className="ws-sr" role="status">{t.loadingCart}</p>
      <div className="ws-page-head" aria-hidden="true">
        <h1 className="ws-h1">{t.cartTitle}</h1>
      </div>
      <div className="ws-cart-layout" aria-hidden="true">
        <div className="ws-lines">
          {[0, 1, 2].map((n) => (
            <div key={n} className="ws-sk-row">
              <div className="ws-sk ws-sk-square" />
              <div className="ws-stack-2"><div className="ws-sk ws-sk-line" /><div className="ws-sk ws-sk-line ws-sk-short" /></div>
            </div>
          ))}
        </div>
        <div className="ws-sk ws-sk-panel" />
      </div>
    </div>
  );
}

/**
 * The cart as handoff/store draws it (checkout-cart-default, checkout-cart-empty): the lines with a quantity stepper
 * and Remove, the order summary beside them (under them on a phone) with Checkout and Continue shopping. It holds no
 * state of the cart, so the canvas draws it with sample lines and the published page with the buyer's.
 */
export function CartView(props: CartViewProps) {
  const { lang, links, phase, lines, count, summary, blocked, unavailableCount } = props;
  const t = STORE_STRINGS[lang];

  if (phase === 'loading') return <CartSkeleton lang={lang} />;

  if (phase === 'error') {
    return (
      <div className="ws-cart-page">
        <div className="ws-page-head"><h1 className="ws-h1">{t.cartTitle}</h1></div>
        <div className="ws-alert ws-alert-in" role="alert">
          <AlertIcon />
          <div className="ws-alert-body">
            <p className="ws-alert-title">{t.cartErrorTitle}</p>
            <p className="ws-alert-text">{t.cartErrorText}</p>
            <div className="ws-alert-actions">
              <button
                className="ws-btn ws-btn-primary ws-btn-sm" type="button"
                onClick={props.onRetry}
              ><RetryIcon />{t.tryAgain}</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (phase === 'empty') {
    return (
      <div className="ws-cart-page">
        <div className="ws-page-head"><h1 className="ws-h1">{t.cartTitle}</h1></div>
        <div className="ws-empty">
          <div className="ws-empty-icon"><BagIcon /></div>
          <h2 className="ws-empty-title">{t.cartEmptyTitle}</h2>
          <p className="ws-empty-text">{t.cartEmptyText}</p>
          <a className="ws-btn ws-btn-primary" href={links.products()}>{t.browseProducts}</a>
        </div>
      </div>
    );
  }

  return (
    <div className="ws-cart-page">
      <div className="ws-page-head">
        <h1 className="ws-h1">{t.cartTitle}</h1>
        <p className="ws-muted">{t.itemCount(count)}</p>
      </div>
      {props.pricesNotChecked && (
        <div className="ws-alert ws-alert-in" role="alert">
          <AlertIcon />
          <div className="ws-alert-body">
            <p className="ws-alert-title">{t.pricesNotCheckedTitle}</p>
            <p className="ws-alert-text">{t.pricesNotCheckedText}</p>
            <div className="ws-alert-actions">
              <button
                className="ws-btn ws-btn-outline ws-btn-sm" type="button"
                onClick={props.onRetryPrices}
              ><RetryIcon />{t.tryAgain}</button>
            </div>
          </div>
        </div>
      )}
      <div className="ws-cart-layout">
        <ul className="ws-lines">
          {lines.map((view) => <CartLineItem
            key={view.line.item_id} view={view}
            lang={lang} onQuantity={props.onQuantity}
            onRemove={props.onRemove}
                               />)}
        </ul>
        <aside className="ws-summary" aria-labelledby="ws-cart-summary-title">
          <h2 className="ws-h2" id="ws-cart-summary-title">{t.orderSummary}</h2>
          {summary ? <SumRows lang={lang} {...summary} /> : <div className="ws-sk ws-sk-block" aria-hidden="true" />}
          {blocked ? (
            <>
              <button
                className="ws-btn ws-btn-block ws-btn-off" type="button"
                disabled aria-describedby={unavailableCount > 0 ? 'ws-cart-checkout-hint' : undefined}
              >{t.checkout}</button>
              {unavailableCount > 0 && <p className="ws-fine" id="ws-cart-checkout-hint">{t.cartBlockedHint(unavailableCount)}</p>}
            </>
          ) : (
            <a className="ws-btn ws-btn-primary ws-btn-block" href={links.checkout()}>{t.checkout}</a>
          )}
          <a className="ws-link-quiet" href={links.products()}>
            <ArrowBackIcon />
            {t.continueShopping}
          </a>
        </aside>
      </div>
    </div>
  );
}
