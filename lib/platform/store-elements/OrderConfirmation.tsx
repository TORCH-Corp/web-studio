'use client';

import React, { useEffect, useState } from 'react';
import { ConfirmationView, type ConfirmationPhase } from '@/lib/platform/store-elements/ConfirmationView';
import type { StoreLinks } from '@/lib/platform/store-elements/links';
import { fetchOrder } from '@/lib/platform/store-elements/store-client';
import type { StoreLang } from '@/lib/platform/store-elements/strings';

interface Props {
  lang: StoreLang;
  links: StoreLinks;
  /** The checkout whose order to show. The confirmation page reads it from the address (`?order=`); a checkout on a site with no confirmation page shows the order itself and names it here. */
  checkoutId?: string;
}

/**
 * The confirmation element on a published page: the order the address's `?order={checkout id}` names, read from
 * `GET /ycode/api/store/orders/{checkout_id}` (Sales's own figures, not the cart's). An address with no checkout, or
 * one this site has no order for, is the designed "can't find this order"; a store that does not sell renders nothing.
 */
export default function OrderConfirmation({ lang, links, checkoutId }: Props) {
  // The address is only in the browser: until it is read the element is its loading state, as the server drew it.
  const [id, setId] = useState<string | null | undefined>(checkoutId);
  const [phase, setPhase] = useState<ConfirmationPhase>({ kind: 'loading' });
  const [selling, setSelling] = useState(true);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (checkoutId) return setId(checkoutId);
    setId(new URLSearchParams(window.location.search).get('order'));
  }, [checkoutId]);

  useEffect(() => {
    if (id === undefined) return;
    if (!id) return setPhase({ kind: 'not_found' });
    const controller = new AbortController();
    fetchOrder(id, controller.signal)
      .then((result) => {
        if (result.kind === 'not_selling') return setSelling(false);
        setPhase(result.kind === 'ok' ? { kind: 'ready', order: result.order } : { kind: 'not_found' });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        console.error('[store] the order could not be read', error);
        setPhase({ kind: 'error' });
      });
    return () => controller.abort();
  }, [id, attempt]);

  if (!selling) return null;
  return (
    <ConfirmationView
      lang={lang}
      links={links}
      phase={phase}
      onRetry={() => {
        setPhase({ kind: 'loading' });
        setAttempt((n) => n + 1);
      }}
    />
  );
}
