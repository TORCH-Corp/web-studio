'use client';

import React from 'react';
import { nameFor } from '@/lib/platform/store-elements/card-data';
import { CardMedia } from '@/lib/platform/store-elements/CardView';
import type { PriceShown } from '@/lib/platform/store-elements/cart-refresh';
import type { CartLine } from '@/lib/platform/store-elements/cart-store';
import { moneyText, optionsText, unitText } from '@/lib/platform/store-elements/format';
import { AlertSmallIcon, TrashIcon } from '@/lib/platform/store-elements/icons';
import type { Money } from '@/lib/platform/store-elements/order-summary';
import { STORE_STRINGS, type StoreLang } from '@/lib/platform/store-elements/strings';

/** One cart line as the cart and the checkout draw it: the line, where its product page is, and what the page has found out about it. */
export interface LineView {
  line: CartLine;
  href: string;
  /** The line's price times its quantity; null while the amounts wait for the store's settings or for the lines to be read again. */
  total: Money | null;
  /** The price the buyer saw when the line's price is not that any more. */
  changedFrom: PriceShown | null;
  /** The catalogue no longer sells it. */
  unavailable: boolean;
}

export const lineName = (line: CartLine, lang: StoreLang): string => nameFor(line.snapshot, lang);

/** Subtotal, delivery fee and total (handoff `sum-rows`). */
export function SumRows({ lang, subtotal, fee, total }: { lang: StoreLang; subtotal: Money; fee: Money; total: Money }) {
  const t = STORE_STRINGS[lang];
  return (
    <dl className="ws-sum-rows">
      <div className="ws-sum-row">
        <dt>{t.subtotal}</dt>
        <dd className="ws-sum-v">{moneyText(subtotal, lang)}</dd>
      </div>
      <div className="ws-sum-row">
        <dt>{t.deliveryFee}</dt>
        <dd className="ws-sum-v">{moneyText(fee, lang)}</dd>
      </div>
      <div className="ws-sum-row ws-sum-total">
        <dt>{t.total}</dt>
        <dd className="ws-sum-v">{moneyText(total, lang)}</dd>
      </div>
    </dl>
  );
}

/** What a line says about itself besides its name: a price that changed, a line the catalogue no longer sells. */
export function LineTags({ view, lang }: { view: Pick<LineView, 'changedFrom' | 'unavailable'>; lang: StoreLang }) {
  const t = STORE_STRINGS[lang];
  return (
    <>
      {view.unavailable && (
        <span className="ws-tag" data-line-state="unavailable">
          <AlertSmallIcon />
          {t.lineUnavailable}
        </span>
      )}
      {!view.unavailable && view.changedFrom && (
        <span className="ws-tag ws-tag-soft" data-line-state="price-updated">
          {t.priceUpdated} · {t.priceWas(moneyText(view.changedFrom, lang))}
        </span>
      )}
    </>
  );
}

interface MiniLineProps {
  imageUrl: string | null;
  name: string;
  options: string;
  /** "2 × 25,000 IQD / Piece" */
  times: string;
  total: string | null;
  tags?: React.ReactNode;
  /** Remove, for a line the catalogue no longer sells. */
  onRemove?: () => void;
  removeLabel?: string;
  lang: StoreLang;
  itemId: string;
}

/** A line of the order summary or the confirmation (handoff `mini`): a small picture, the name and options, the quantity times the price, the line total. */
export function MiniLine({ imageUrl, name, options, times, total, tags, onRemove, removeLabel, lang, itemId }: MiniLineProps) {
  const t = STORE_STRINGS[lang];
  return (
    <li className="ws-mini" data-item-id={itemId}>
      <div className="ws-mini-thumb"><CardMedia url={imageUrl} label={t.productImage} /></div>
      <div className="ws-line-body">
        <p className="ws-mini-name">{name}</p>
        {options && <p className="ws-line-opts">{options}</p>}
        {tags}
        {onRemove && (
          <button
            className="ws-remove" type="button"
            aria-label={removeLabel} onClick={onRemove}
          >
            <TrashIcon />
            <span aria-hidden="true">{t.remove}</span>
          </button>
        )}
      </div>
      <div className="ws-mini-end">
        <p className="ws-line-unit">{times}</p>
        {total !== null && <p className="ws-sum-v">{total}</p>}
      </div>
    </li>
  );
}

/** The quantity times the price, with the unit's name when the item has one: "2 × 25,000 IQD / Piece". */
export function timesText(quantity: string, price: Money, unit: { name: string; symbol?: string } | null, lang: StoreLang): string {
  const u = unitText(unit);
  return `${quantity} × ${moneyText(price, lang)}${u ? ` / ${u}` : ''}`;
}

/** The mini lines of the checkout's summary. */
export function SummaryLines({ lang, lines, onRemove }: { lang: StoreLang; lines: LineView[]; onRemove: (itemId: string) => void }) {
  const t = STORE_STRINGS[lang];
  return (
    <ul className="ws-mini-lines">
      {lines.map((view) => {
        const { line } = view;
        const name = lineName(line, lang);
        return (
          <MiniLine
            key={line.item_id}
            lang={lang}
            itemId={line.item_id}
            imageUrl={line.snapshot.image}
            name={name}
            options={optionsText(line.snapshot.axes, lang)}
            times={timesText(String(line.quantity), line.snapshot.price, line.snapshot.unit, lang)}
            total={view.total && !view.unavailable ? moneyText(view.total, lang) : null}
            tags={<LineTags view={view} lang={lang} />}
            onRemove={view.unavailable ? () => onRemove(line.item_id) : undefined}
            removeLabel={t.removeLine(name)}
          />
        );
      })}
    </ul>
  );
}
