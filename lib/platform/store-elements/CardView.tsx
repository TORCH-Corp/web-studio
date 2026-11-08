'use client';

import React, { useState } from 'react';
import clsx from 'clsx';
import { AlertIcon, ImageIcon, RetryIcon } from '@/lib/platform/store-elements/icons';
import { nameFor, type CardData } from '@/lib/platform/store-elements/card-data';
import { formatPrice } from '@/lib/platform/store-elements/format';
import { STORE_STRINGS, type StoreLang } from '@/lib/platform/store-elements/strings';

/** The product's picture, or the placeholder tile (the handoff's grey square with an icon and a label). */
function CardMedia({ url, label }: { url: string | null; label: string }) {
  // An image the site cannot serve (a refused type, a document gone) leaves the placeholder tile, not a broken picture.
  const [failed, setFailed] = useState(false);
  const showImage = !!url && !failed;
  return (
    <div
      className={clsx('ws-ph', showImage && 'ws-ph-img')}
      role="img"
      aria-label={label}
    >
      {showImage ? (
        // The picture is the site's own /store-media route, already cached and sized by the platform: no image optimizer in front of it.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
        />
      ) : (
        <>
          <ImageIcon />
          <span className="ws-ph-label">{label}</span>
        </>
      )}
    </div>
  );
}

interface CardViewProps {
  card: CardData;
  lang: StoreLang;
  /** The product page. */
  href: string;
  /** "Add to cart" on a card without variants. */
  onAdd: (card: CardData) => void;
}

/** One product card, as handoff/store draws it: image, name (two lines at most), price or "from" price, and one button. */
export function ProductCardView({ card, lang, href, onAdd }: CardViewProps) {
  const t = STORE_STRINGS[lang];
  return (
    <article className="ws-card" data-product-id={card.id}>
      <a
        className="ws-card-media" href={href}
        tabIndex={-1} aria-hidden="true"
      >
        <CardMedia url={card.imageUrl} label={t.productImage} />
      </a>
      <h3 className="ws-card-name ws-clamp2">
        <a className="ws-card-link" href={href}>{nameFor(card, lang)}</a>
      </h3>
      <p className="ws-card-price">
        {card.from && <><span className="ws-card-from">{t.from}</span>{' '}</>}
        {formatPrice(card.price, lang)}
      </p>
      {card.hasVariants ? (
        <a className="ws-btn ws-btn-outline ws-btn-sm ws-btn-block ws-card-btn" href={href}>{t.chooseOptions}</a>
      ) : (
        <button
          className="ws-btn ws-btn-primary ws-btn-sm ws-btn-block ws-card-btn" type="button"
          onClick={() => onAdd(card)}
        >{t.addToCart}</button>
      )}
    </article>
  );
}

/** The card's skeleton while its product loads: image, two lines and a button (handoff `loading`). */
export function CardSkeleton() {
  return (
    <div className="ws-card">
      <div className="ws-sk ws-sk-media" />
      <div className="ws-sk ws-sk-line" />
      <div className="ws-sk ws-sk-line ws-sk-short" />
      <div className="ws-sk ws-sk-btn" />
    </div>
  );
}

/** The designed error pattern (handoff alert) for a catalogue that cannot be read, with the way to try again. */
export function ErrorAlert({ lang, onRetry }: { lang: StoreLang; onRetry: () => void }) {
  const t = STORE_STRINGS[lang];
  return (
    <div className="ws-alert" role="alert">
      <AlertIcon />
      <div className="ws-alert-body">
        <p className="ws-alert-title">{t.errorTitle}</p>
        <p className="ws-alert-text">{t.errorText}</p>
        <div className="ws-alert-actions">
          <button
            className="ws-btn ws-btn-primary ws-btn-sm" type="button"
            onClick={onRetry}
          >
            <RetryIcon />
            {t.tryAgain}
          </button>
        </div>
      </div>
    </div>
  );
}
