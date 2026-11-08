'use client';

import React, { useEffect, useState } from 'react';
import { cartCount, subscribeToCart } from '@/lib/platform/store-elements/cart-store';
import { BagIcon } from '@/lib/platform/store-elements/icons';
import type { StoreLinks } from '@/lib/platform/store-elements/links';
import { fetchStoreSettings } from '@/lib/platform/store-elements/store-client';
import { badgeText, STORE_STRINGS, type StoreLang } from '@/lib/platform/store-elements/strings';

interface ViewProps {
  count: number;
  lang: StoreLang;
  href: string;
  /** Counts the changes since the page opened; the badge settles once for each (not at all under reduced motion). 0 draws it still. */
  changes?: number;
}

/** The cart indicator as handoff/store draws it (component-cart-indicator-*): a bag in a pill, the count badge hidden at 0, "99+" above 99. */
export function CartIndicatorView({ count, lang, href, changes = 0 }: ViewProps) {
  const t = STORE_STRINGS[lang];
  const badge = badgeText(count);
  return (
    <a
      className="ws-cart"
      href={href}
      aria-label={badge ? t.cartCount(count) : t.cartEmpty}
    >
      <BagIcon />
      <span
        className="ws-cart-label"
        aria-hidden="true"
      >
        {t.cartLabel}
      </span>
      {badge && (
        <span
          key={changes}
          className="ws-badge"
          aria-hidden="true"
          data-changed={changes > 0 ? '' : undefined}
        >
          {badge}
        </span>
      )}
    </a>
  );
}

/**
 * The cart indicator on a published page: the connected cart's count (W5), following it as it changes. A store
 * that does not sell renders nothing, like every store element (PRD V1.1 "Store settings").
 */
export default function CartIndicator({ lang, links }: { lang: StoreLang; links: StoreLinks }) {
  // The server and the first browser render show an empty cart; the cart is read in the browser.
  const [count, setCount] = useState(0);
  const [changes, setChanges] = useState(0);
  const [selling, setSelling] = useState(true);

  useEffect(() => {
    setCount(cartCount());
    return subscribeToCart(() => {
      setCount(cartCount());
      setChanges((n) => n + 1);
    });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetchStoreSettings(controller.signal)
      .then((result) => setSelling(result.kind === 'ok'))
      .catch((error: unknown) => {
        // The indicator does not need the settings to show the count: a store that cannot be asked keeps it.
        if (!controller.signal.aborted) console.error('[store] the store settings could not be read', error);
      });
    return () => controller.abort();
  }, []);

  if (!selling) return null;

  return (
    <CartIndicatorView
      count={count}
      lang={lang}
      href={links.cart()}
      changes={changes}
    />
  );
}
