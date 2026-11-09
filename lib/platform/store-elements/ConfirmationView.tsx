'use client';

import React from 'react';
import type { Confirmation } from '@/lib/platform/checkout-rules';
import { moneyText, optionsText, quantityText } from '@/lib/platform/store-elements/format';
import { AlertIcon, BoxIcon, CashIcon, CheckIcon, RetryIcon } from '@/lib/platform/store-elements/icons';
import type { StoreLinks } from '@/lib/platform/store-elements/links';
import { MiniLine, SumRows, timesText } from '@/lib/platform/store-elements/OrderLines';
import { confirmationLineName } from '@/lib/platform/store-elements/card-data';
import { STORE_STRINGS, type StoreLang } from '@/lib/platform/store-elements/strings';

export type ConfirmationPhase =
  | { kind: 'loading' }
  | { kind: 'ready'; order: Confirmation }
  /** No order of this site for the address's checkout (or no checkout in the address). */
  | { kind: 'not_found' }
  /** Sales could not be asked. */
  | { kind: 'error' };

export interface ConfirmationViewProps {
  lang: StoreLang;
  links: StoreLinks;
  phase: ConfirmationPhase;
  onRetry: () => void;
}

export function ConfirmationSkeleton({ lang }: { lang: StoreLang }) {
  const t = STORE_STRINGS[lang];
  return (
    <div className="ws-conf" aria-busy="true">
      <p className="ws-sr" role="status">{t.loadingOrder}</p>
      <div className="ws-conf-head" aria-hidden="true">
        <div className="ws-sk ws-sk-square" style={{ width: 'var(--ws-size-icon-xl)', borderRadius: 'var(--ws-radius-full)' }} />
        <div className="ws-sk ws-sk-title" style={{ width: '60%' }} />
      </div>
      <div className="ws-sk ws-sk-block" aria-hidden="true" />
      <div className="ws-sk ws-sk-panel" aria-hidden="true" />
    </div>
  );
}

/**
 * The confirmation as handoff/store draws it (checkout-confirmation-default): the thank-you, the order code, the lines
 * with their options, the fee and the total, the cash-on-delivery note and the way back to the shop; and the states
 * the handoff leaves to the designed patterns: loading, an order that cannot be found, one that cannot be read now.
 */
export function ConfirmationView({ lang, links, phase, onRetry }: ConfirmationViewProps) {
  const t = STORE_STRINGS[lang];

  if (phase.kind === 'loading') return <ConfirmationSkeleton lang={lang} />;

  if (phase.kind === 'not_found') {
    return (
      <div className="ws-conf">
        <div className="ws-empty" data-state="not-found">
          <div className="ws-empty-icon"><BoxIcon /></div>
          <h1 className="ws-empty-title">{t.orderNotFoundTitle}</h1>
          <p className="ws-empty-text">{t.orderNotFoundText}</p>
          <a className="ws-btn ws-btn-primary" href={links.products()}>{t.backToShop}</a>
        </div>
      </div>
    );
  }

  if (phase.kind === 'error') {
    return (
      <div className="ws-conf">
        <div className="ws-alert ws-alert-in" role="alert">
          <AlertIcon />
          <div className="ws-alert-body">
            <p className="ws-alert-title">{t.orderErrorTitle}</p>
            <p className="ws-alert-text">{t.orderErrorText}</p>
            <div className="ws-alert-actions">
              <button
                className="ws-btn ws-btn-primary ws-btn-sm" type="button"
                onClick={onRetry}
              ><RetryIcon />{t.tryAgain}</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const { order } = phase;
  const money = (amount: string) => ({ amount, currency: order.currency });
  return (
    <div className="ws-conf" data-state="ready">
      <div className="ws-conf-head">
        <div className="ws-empty-icon"><CheckIcon className="ws-icon-lg" /></div>
        <h1 className="ws-h1">{t.thanksTitle}</h1>
        <p className="ws-conf-text">
          {order.phone ? (
            <>
              {t.callYouBefore}
              <span dir="ltr">{order.phone}</span>
              {t.callYouAfter}
            </>
          ) : (
            t.callYouNoPhone
          )}
        </p>
      </div>

      <div className="ws-code-box">
        <span className="ws-code-label">{t.orderCode}</span>
        <span
          className="ws-code" dir="ltr"
          data-order-code
        >{order.code}</span>
        <span className="ws-code-hint">{t.orderCodeHint}</span>
      </div>

      <section className="ws-box" aria-labelledby="ws-conf-details-title">
        <h2 className="ws-h2" id="ws-conf-details-title">{t.orderDetails}</h2>
        <ul className="ws-mini-lines">
          {order.lines.map((line) => (
            <MiniLine
              key={line.item_id}
              lang={lang}
              itemId={line.item_id}
              imageUrl={null}
              name={confirmationLineName(line, lang)}
              options={optionsText(line.axes, lang)}
              times={timesText(quantityText(line.quantity), money(line.unit_price), line.unit, lang)}
              total={moneyText(money(line.line_total), lang)}
            />
          ))}
        </ul>
        <hr className="ws-divider" />
        <SumRows
          lang={lang} subtotal={money(order.subtotal)}
          fee={money(order.delivery_fee)} total={money(order.total)}
        />
      </section>

      <div className="ws-cod">
        <CashIcon />
        <div>
          <p className="ws-cod-title">{t.cashOnDelivery}</p>
          <p className="ws-cod-text">{t.cashReady(moneyText(money(order.total), lang))}</p>
        </div>
      </div>

      <a className="ws-btn ws-btn-primary ws-btn-block" href={links.products()}>{t.backToShop}</a>
    </div>
  );
}
