'use client';

import React from 'react';
import clsx from 'clsx';
import type { StoreAxis, StoreProduct, StoreVariant } from '@/lib/platform/catalogue-rules';
import { nameFor } from '@/lib/platform/store-elements/card-data';
import { CardMedia } from '@/lib/platform/store-elements/CardView';
import { formatPrice } from '@/lib/platform/store-elements/format';
import { AlertIcon, BagIcon, BoxIcon, CheckIcon, MinusIcon, PlusIcon } from '@/lib/platform/store-elements/icons';
import type { StoreLinks } from '@/lib/platform/store-elements/links';
import { galleryFor, optionRows, type Selection } from '@/lib/platform/store-elements/picker';
import { STORE_STRINGS, type StoreLang } from '@/lib/platform/store-elements/strings';

/** The "added" notice: the product's name as the cart shows it, and the options picked (in the page's language). */
export interface AddedNotice {
  name: string;
  options: string[];
}

export interface ProductDetailViewProps {
  product: StoreProduct;
  lang: StoreLang;
  links: StoreLinks;
  selection: Selection;
  variant: StoreVariant | null;
  /** A thumbnail the buyer clicked (a document id), until the variant changes. */
  pickedImage: string | null;
  /** The stepper's text: what the buyer typed, which may not be a number yet. */
  quantity: string;
  minQuantity: number;
  maxQuantity: number;
  added: AddedNotice | null;
  cartFull: boolean;
  onSelect: (specificationId: string, optionId: string) => void;
  onPickImage: (documentId: string) => void;
  onQuantityText: (text: string) => void;
  onQuantityCommit: () => void;
  onStep: (delta: number) => void;
  onAdd: () => void;
}

/** The axis, the option, in the page's language: Arabic when the page is Arabic and the catalogue has the Arabic label. */
const axisName = (axis: Pick<StoreAxis, 'name' | 'name_ar'>, lang: StoreLang) => (lang === 'ar' && axis.name_ar ? axis.name_ar : axis.name);
const optionLabel = (option: { label: string; label_ar: string | null }, lang: StoreLang) => (lang === 'ar' && option.label_ar ? option.label_ar : option.label);

/**
 * The product page as handoff/store draws it (browse-product-*): the gallery, the name and SKU, the price with its
 * unit, one row of chips per axis, the quantity stepper and Add to cart, the "added" notice, the description. It
 * holds no state of its own, so the canvas draws it with sample data and the published page with the live product.
 */
export function ProductDetailView(props: ProductDetailViewProps) {
  const { product, lang, links, selection, variant, pickedImage, quantity, added, cartFull } = props;
  const t = STORE_STRINGS[lang];
  const rows = optionRows(product, selection);
  const gallery = galleryFor(product, variant, pickedImage);
  const price = variant?.price ?? product.price;
  const name = nameFor(product, lang);
  const description = lang === 'ar' && product.description_ar ? product.description_ar : product.description;
  const unit = product.unit ? product.unit.symbol || product.unit.name : null;
  // A product with variants can be bought once a variant that can be bought is chosen.
  const canBuy = product.variants.length === 0 || (variant !== null && variant.available);
  const quantityNumber = Number(quantity);

  return (
    <div className="ws-pd">
      <div className="ws-gallery">
        <CardMedia
          url={gallery.main?.url || null} label={name}
          eager
        />
        {gallery.thumbs.length > 0 && (
          <div className="ws-thumbs">
            {gallery.thumbs.map((thumb, index) => (
              <button
                key={thumb.image.document_id}
                className={clsx('ws-thumb', thumb.on && 'ws-thumb-on')}
                type="button"
                aria-label={t.showImage(index + 1)}
                aria-pressed={thumb.on}
                onClick={() => props.onPickImage(thumb.image.document_id)}
              >
                <CardMedia url={thumb.image.url || null} label={t.productImage} />
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="ws-info">
        <div className="ws-pd-head">
          <h1 className="ws-pd-title">{name}</h1>
          <p className="ws-sku">{t.sku}: <span dir="ltr">{variant?.sku ?? product.sku}</span></p>
        </div>

        <p className="ws-pd-price">
          {!variant && product.price.from && <><span className="ws-pd-from">{t.from}</span>{' '}</>}
          {formatPrice(price, lang)}
          {unit && <span className="ws-pd-unit">{' / '}<span dir="ltr">{unit}</span></span>}
        </p>

        {rows.map((row) => {
          const chosen = row.options.find((option) => option.selected);
          return (
            <fieldset className="ws-fs" key={row.axis.id}>
              <legend className="ws-legend">
                {t.axisLabel(axisName(row.axis, lang))} <span className="ws-legend-val">{chosen ? optionLabel(chosen, lang) : ''}</span>
              </legend>
              <div className="ws-opts">
                {row.options.map((option) =>
                  option.unavailable ? (
                    <button
                      key={option.id} className="ws-opt ws-opt-off"
                      type="button" disabled
                      aria-disabled="true"
                    >
                      <span className="ws-strike">{optionLabel(option, lang)}</span>
                      {' '}
                      <span className="ws-opt-note">· {t.unavailableOption}</span>
                    </button>
                  ) : (
                    <button
                      key={option.id}
                      className={clsx('ws-opt', option.selected && 'ws-opt-on')}
                      type="button"
                      aria-pressed={option.selected}
                      onClick={() => props.onSelect(row.axis.id, option.id)}
                    >
                      {optionLabel(option, lang)}
                    </button>
                  ),
                )}
              </div>
            </fieldset>
          );
        })}

        <div className="ws-buy">
          <div
            className="ws-stepper" role="group"
            aria-label={t.quantity}
          >
            <button
              className="ws-step-btn" type="button"
              aria-label={t.decreaseQuantity} disabled={quantityNumber <= props.minQuantity}
              onClick={() => props.onStep(-1)}
            ><MinusIcon /></button>
            <input
              className="ws-step-val" type="text"
              inputMode="numeric" value={quantity}
              aria-label={t.quantity}
              onChange={(event) => props.onQuantityText(event.target.value)}
              onBlur={props.onQuantityCommit}
            />
            <button
              className="ws-step-btn" type="button"
              aria-label={t.increaseQuantity} disabled={quantityNumber >= props.maxQuantity}
              onClick={() => props.onStep(1)}
            ><PlusIcon /></button>
          </div>
          <button
            className="ws-btn ws-btn-primary ws-buy-btn" type="button"
            disabled={!canBuy} onClick={props.onAdd}
          >
            <BagIcon />
            {t.addToCart}
          </button>
        </div>

        {cartFull && (
          <div className="ws-alert" role="alert">
            <AlertIcon />
            <div className="ws-alert-body"><p className="ws-alert-text">{t.cartFull}</p></div>
          </div>
        )}
        {added && !cartFull && (
          <div className="ws-notice" role="status">
            <CheckIcon className="ws-notice-icon" />
            <p className="ws-notice-text">{t.addedToCart(added.name, added.options)}</p>
            <a className="ws-notice-link" href={links.cart()}>{t.viewCart}</a>
          </div>
        )}

        {description && (
          <>
            <hr className="ws-divider" />
            <div className="ws-stack-2">
              <h2 className="ws-h2">{t.description}</h2>
              <p className="ws-desc">{description}</p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** The product page while its product loads: the gallery, the name, price, options and button as grey blocks (the card skeleton's pattern). */
export function ProductDetailSkeleton({ lang }: { lang: StoreLang }) {
  const t = STORE_STRINGS[lang];
  return (
    <div className="ws-pd" aria-busy="true">
      <p className="ws-sr" role="status">{t.loadingProduct}</p>
      <div className="ws-gallery" aria-hidden="true">
        <div className="ws-sk ws-sk-media" />
        <div className="ws-thumbs">
          {[0, 1, 2, 3].map((n) => <div key={n} className="ws-sk ws-sk-thumb" />)}
        </div>
      </div>
      <div className="ws-info" aria-hidden="true">
        <div className="ws-sk ws-sk-title" />
        <div className="ws-sk ws-sk-line ws-sk-short" />
        <div className="ws-sk ws-sk-title ws-sk-short" />
        <div className="ws-sk-chips">{[0, 1, 2, 3].map((n) => <div key={n} className="ws-sk ws-sk-chip" />)}</div>
        <div className="ws-sk ws-sk-btn" />
      </div>
    </div>
  );
}

/** The product is gone or never was: the designed empty pattern, with the way back to the shop. */
export function ProductGoneView({ lang, links }: { lang: StoreLang; links: StoreLinks }) {
  const t = STORE_STRINGS[lang];
  return (
    <div className="ws-empty">
      <div className="ws-empty-icon"><BoxIcon /></div>
      <h1 className="ws-empty-title">{t.notOnSaleTitle}</h1>
      <p className="ws-empty-text">{t.notOnSaleText}</p>
      <a className="ws-btn ws-btn-primary" href={links.products()}>{t.browseProducts}</a>
    </div>
  );
}
