'use client';

import React, { useId } from 'react';
import clsx from 'clsx';
import { FormHoneypotField } from '@/components/FormHoneypotField';
import { HONEYPOT_FIELD_NAME } from '@/lib/form-spam-settings';
import { invalidFields, type FormErrors, type FormField, type FormValues } from '@/lib/platform/store-elements/checkout-form';
import { moneyText } from '@/lib/platform/store-elements/format';
import { IRAQ_GOVERNORATES } from '@/lib/platform/iraq-governorates';
import { AlertIcon, ArrowBackIcon, BagIcon, CashIcon, ChevronDownIcon, RetryIcon } from '@/lib/platform/store-elements/icons';
import type { StoreLinks } from '@/lib/platform/store-elements/links';
import type { Money } from '@/lib/platform/store-elements/order-summary';
import { SumRows, SummaryLines, type LineView } from '@/lib/platform/store-elements/OrderLines';
import { STORE_STRINGS, type StoreLang } from '@/lib/platform/store-elements/strings';

/** What the alert over the form says, if anything. */
export type CheckoutBanner =
  /** The route refused fields: they are listed, each a link to the field. */
  | { kind: 'validation' }
  | { kind: 'service' }
  | { kind: 'rate_limited' }
  /** Items the store no longer sells, named; the alert offers to remove them all. */
  | { kind: 'items'; names: string[] };

export interface CheckoutViewProps {
  lang: StoreLang;
  links: StoreLinks;
  phase: 'loading' | 'error' | 'empty' | 'ready';
  lines: LineView[];
  count: number;
  summary: { subtotal: Money; fee: Money; total: Money } | null;
  values: FormValues;
  errors: FormErrors;
  banner: CheckoutBanner | null;
  submitting: boolean;
  /** Place order is off: a line is unavailable, or the amounts are not known yet. */
  blocked: boolean;
  unavailableCount: number;
  onChange: (field: FormField, value: string) => void;
  /** `honeypot` is what the form's decoy field held; empty for a person. */
  onSubmit: (honeypot?: string) => void;
  onRemove: (itemId: string) => void;
  onRemoveUnavailable: () => void;
  onRetry: () => void;
}

/** The checkout's skeleton while the cart and the store's settings are read. */
export function CheckoutSkeleton({ lang }: { lang: StoreLang }) {
  const t = STORE_STRINGS[lang];
  return (
    <div className="ws-checkout-page" aria-busy="true">
      <p className="ws-sr" role="status">{t.loadingCheckout}</p>
      <div className="ws-page-head" aria-hidden="true">
        <h1 className="ws-h1">{t.checkout}</h1>
      </div>
      <div className="ws-cart-layout" aria-hidden="true">
        <div className="ws-co-main">
          {[0, 1, 2, 3].map((n) => <div key={n} className="ws-sk ws-sk-block" />)}
        </div>
        <div className="ws-sk ws-sk-panel" />
      </div>
    </div>
  );
}

const FIELD_LABEL = (t: (typeof STORE_STRINGS)['en'], field: FormField): string =>
  ({ name: t.fullName, phone: t.phone, city: t.city, address: t.address, landmark: t.landmark, notes: t.notes })[field];

/**
 * The checkout as handoff/store draws it (checkout-form-*): the order summary (a collapsed bar on a phone, a column
 * on a desktop), the delivery form, the cash-on-delivery note and Place order, with the designed states: an alert
 * listing the fields to fix, the fields disabled while the order is sent, the service that cannot be reached, the
 * items that are no longer available. It holds no state of its own, so the canvas draws it with sample data.
 */
export function CheckoutView(props: CheckoutViewProps) {
  const { lang, links, phase, lines, count, summary, values, errors, banner, submitting, blocked, unavailableCount } = props;
  const t = STORE_STRINGS[lang];
  const uid = useId();
  const id = (field: string) => `${uid}-${field}`;

  const head = (
    <div className="ws-page-head">
      <a className="ws-back" href={links.cart()}>
        <ArrowBackIcon />
        {t.backToCart}
      </a>
      <h1 className="ws-h1">{t.checkout}</h1>
    </div>
  );

  if (phase === 'loading') return <CheckoutSkeleton lang={lang} />;

  if (phase === 'error') {
    return (
      <div className="ws-checkout-page">
        {head}
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
      <div className="ws-checkout-page">
        {head}
        <div className="ws-empty">
          <div className="ws-empty-icon"><BagIcon /></div>
          <h2 className="ws-empty-title">{t.cartEmptyTitle}</h2>
          <p className="ws-empty-text">{t.cartEmptyText}</p>
          <a className="ws-btn ws-btn-primary" href={links.products()}>{t.browseProducts}</a>
        </div>
      </div>
    );
  }

  const invalid = invalidFields(errors);
  const focusField = (field: string) => (event: React.MouseEvent) => {
    event.preventDefault();
    document.getElementById(id(field))?.focus();
  };

  const fieldProps = (field: FormField) => {
    const message = errors.fields[field];
    return {
      id: id(field),
      disabled: submitting,
      'aria-invalid': message ? true : undefined,
      'aria-describedby': message ? `${id(field)}-err` : field === 'phone' ? `${id(field)}-help` : undefined,
      value: values[field],
      onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => props.onChange(field, event.target.value),
    };
  };
  /** The input's classes: the shared ones, the error's and the disabled look, and the field's own. */
  const inputClass = (field: FormField, own?: string) => clsx('ws-input', errors.fields[field] && 'ws-input-err', submitting && 'ws-input-off', own);
  const fieldError = (field: FormField) =>
    errors.fields[field] ? (
      <p className="ws-err" id={`${id(field)}-err`}>
        <AlertIcon />
        <span>{errors.fields[field]}</span>
      </p>
    ) : null;

  const summaryBody = (
    <>
      <SummaryLines
        lang={lang} lines={lines}
        onRemove={props.onRemove}
      />
      {summary ? <SumRows lang={lang} {...summary} /> : <div className="ws-sk ws-sk-block" aria-hidden="true" />}
    </>
  );

  return (
    <div className="ws-checkout-page">
      {head}
      <div className="ws-cart-layout">
        <div className="ws-co-main">
          {banner?.kind === 'validation' && (
            <div
              className="ws-alert ws-alert-in" role="alert"
              data-banner="validation"
            >
              <AlertIcon />
              <div className="ws-alert-body">
                <p className="ws-alert-title">{t.fixFields(invalid.length)}</p>
                <ul className="ws-alert-list">
                  {invalid.map((field) => (
                    <li key={field}>
                      <a
                        className="ws-alert-link" href={`#${id(field)}`}
                        onClick={focusField(field)}
                      >{FIELD_LABEL(t, field)}</a>
                    </li>
                  ))}
                  {errors.general.map((message) => <li key={message}>{message}</li>)}
                </ul>
              </div>
            </div>
          )}
          {banner?.kind === 'service' && (
            <div
              className="ws-alert ws-alert-in" role="alert"
              data-banner="service"
            >
              <AlertIcon />
              <div className="ws-alert-body">
                <p className="ws-alert-title">{t.serviceTitle}</p>
                <p className="ws-alert-text">{t.serviceText}</p>
                <div className="ws-alert-actions">
                  <button
                    className="ws-btn ws-btn-primary ws-btn-sm" type="button"
                    disabled={submitting} onClick={() => props.onSubmit()}
                  ><RetryIcon />{t.tryAgain}</button>
                </div>
              </div>
            </div>
          )}
          {banner?.kind === 'rate_limited' && (
            <div
              className="ws-alert ws-alert-in" role="alert"
              data-banner="rate-limited"
            >
              <AlertIcon />
              <div className="ws-alert-body">
                <p className="ws-alert-title">{t.rateLimitedTitle}</p>
                <p className="ws-alert-text">{t.rateLimitedText}</p>
              </div>
            </div>
          )}
          {banner?.kind === 'items' && (
            <div
              className="ws-alert ws-alert-in" role="alert"
              data-banner="items"
            >
              <AlertIcon />
              <div className="ws-alert-body">
                <p className="ws-alert-title">{t.itemsUnavailableTitle(banner.names.length)}</p>
                <p className="ws-alert-text">{t.itemsUnavailableText(banner.names)}</p>
                <div className="ws-alert-actions">
                  <button
                    className="ws-btn ws-btn-outline ws-btn-sm" type="button"
                    onClick={props.onRemoveUnavailable}
                  >{t.removeItems(banner.names.length)}</button>
                </div>
              </div>
            </div>
          )}

          <details className="ws-co-phone">
            <summary className="ws-sum-bar">
              <span className="ws-sum-bar-side">
                <BagIcon />
                {t.orderSummary}
                <span className="ws-muted">{t.summaryCount(count)}</span>
              </span>
              <span className="ws-sum-bar-side">
                {summary ? moneyText(summary.total, lang) : null}
                <ChevronDownIcon className="ws-chev" />
              </span>
            </summary>
            <div className="ws-sum-panel">{summaryBody}</div>
          </details>

          <form
            className="ws-form" noValidate
            aria-busy={submitting || undefined}
            onSubmit={(event) => {
              event.preventDefault();
              const decoy = new FormData(event.currentTarget).get(HONEYPOT_FIELD_NAME);
              props.onSubmit(typeof decoy === 'string' ? decoy : '');
            }}
          >
            {/* ycode's decoy field sits 9999 px to the left of the form; on a right to left page that would widen the page by as
                much, so it is kept in a box of no size that clips it. */}
            <div className="ws-decoy"><FormHoneypotField /></div>
            <fieldset className="ws-form-sec">
              <legend className="ws-form-sec-title">{t.deliveryDetails}</legend>
              <div className="ws-form-row">
                <div className="ws-field">
                  <label className="ws-label" htmlFor={id('name')}>{t.fullName}</label>
                  <input
                    {...fieldProps('name')} className={inputClass('name')}
                    type="text" placeholder={t.fullNamePlaceholder}
                    autoComplete="name"
                  />
                  {fieldError('name')}
                </div>
                <div className="ws-field">
                  <label className="ws-label" htmlFor={id('phone')}>{t.phone}</label>
                  <input
                    {...fieldProps('phone')} className={inputClass('phone', 'ws-input-ltr')}
                    type="tel" inputMode="tel"
                    dir="ltr" placeholder={t.phonePlaceholder}
                    autoComplete="tel"
                  />
                  {fieldError('phone')}
                  <p className="ws-help" id={`${id('phone')}-help`}>{t.phoneHelp}</p>
                </div>
              </div>
              <div className="ws-form-row">
                <div className="ws-field">
                  <label className="ws-label" htmlFor={id('city')}>{t.city}</label>
                  <div className="ws-select-wrap">
                    <select
                      {...fieldProps('city')} className={inputClass('city', 'ws-select')}
                      autoComplete="address-level1"
                    >
                      <option value="">{t.chooseCity}</option>
                      {IRAQ_GOVERNORATES.map((governorate) => <option key={governorate.code} value={governorate.code}>{governorate[lang]}</option>)}
                    </select>
                    <ChevronDownIcon className="ws-select-chev" />
                  </div>
                  {fieldError('city')}
                </div>
                <div className="ws-field">
                  <label className="ws-label" htmlFor={id('address')}>{t.address}</label>
                  <input
                    {...fieldProps('address')} className={inputClass('address')}
                    type="text" placeholder={t.addressPlaceholder}
                    autoComplete="street-address"
                  />
                  {fieldError('address')}
                </div>
              </div>
              <div className="ws-field">
                <label className="ws-label" htmlFor={id('landmark')}>{t.landmark} <span className="ws-label-opt">{t.optional}</span></label>
                <input
                  {...fieldProps('landmark')} className={inputClass('landmark')}
                  type="text" placeholder={t.landmarkPlaceholder}
                />
                {fieldError('landmark')}
              </div>
              <div className="ws-field">
                <label className="ws-label" htmlFor={id('notes')}>{t.notes} <span className="ws-label-opt">{t.optional}</span></label>
                <textarea
                  {...fieldProps('notes')} className={inputClass('notes', 'ws-textarea')}
                  rows={3} placeholder={t.notesPlaceholder}
                />
                {fieldError('notes')}
              </div>
            </fieldset>

            <fieldset className="ws-form-sec">
              <legend className="ws-form-sec-title">{t.payment}</legend>
              <div className="ws-cod">
                <CashIcon />
                <div>
                  <p className="ws-cod-title">{t.cashOnDelivery}</p>
                  <p className="ws-cod-text">{t.cashOnDeliveryText}</p>
                </div>
              </div>
            </fieldset>

            <button
              className={clsx('ws-btn ws-btn-block ws-btn-place', blocked && !submitting ? 'ws-btn-off' : 'ws-btn-primary', submitting && 'ws-btn-busy')}
              type="submit"
              disabled={submitting || blocked}
              aria-describedby={blocked && unavailableCount > 0 ? `${uid}-hint` : undefined}
            >
              {submitting ? (
                <>
                  <span className="ws-spinner" aria-hidden="true" />
                  {t.placing}
                </>
              ) : (
                summary ? t.placeOrder(moneyText(summary.total, lang)) : t.placeOrderShort
              )}
            </button>
            {submitting && <p className="ws-sr" role="status">{t.placing}</p>}
            {blocked && !submitting && unavailableCount > 0 && <p className="ws-fine" id={`${uid}-hint`}>{t.removeToPlace(unavailableCount)}</p>}
          </form>
        </div>

        <aside className="ws-co-side">
          <div className="ws-summary">
            <h2 className="ws-h2">{t.orderSummary}</h2>
            {summaryBody}
          </div>
        </aside>
      </div>
    </div>
  );
}
