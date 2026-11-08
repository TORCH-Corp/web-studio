'use client';

import React from 'react';
import { getCartStore } from '@/lib/platform/store-elements/cart-store';
import { CartView } from '@/lib/platform/store-elements/CartView';
import type { StoreLinks } from '@/lib/platform/store-elements/links';
import { summarise } from '@/lib/platform/store-elements/order-summary';
import type { LineView } from '@/lib/platform/store-elements/OrderLines';
import type { StoreLang } from '@/lib/platform/store-elements/strings';
import { useCartLines, useCartRefresh, useStoreTerms } from '@/lib/platform/store-elements/use-cart';

/**
 * The cart element on a published page: the buyer's cart (kept in the browser, W5) with the store's currency and
 * delivery fee (`GET /ycode/api/store/settings`). The lines show what the buyer saw when they added them; once the
 * element is open the catalogue is read for each product in the cart, a changed price updates its line and says
 * so, and a line the store no longer sells is marked and keeps Checkout off until it is removed. A store that does
 * not sell renders nothing, like every store element (PRD V1.1 "Store settings").
 */
export default function Cart({ lang, links }: { lang: StoreLang; links: StoreLinks }) {
  const { lines, ready } = useCartLines();
  const { state: terms, retry: retryTerms } = useStoreTerms();
  const refresh = useCartRefresh(ready && lines.length > 0);

  if (terms.kind === 'not_selling') return null;

  const store = getCartStore();
  const summary = terms.kind === 'ok' ? summarise(lines, terms.terms) : null;
  const views: LineView[] = lines.map((line) => ({
    line,
    href: links.product(line.product_id),
    total: summary?.kind === 'ready' ? (summary.lines.find((row) => row.line.item_id === line.item_id)?.total ?? null) : null,
    changedFrom: refresh.report.changed.get(line.item_id) ?? null,
    unavailable: refresh.report.unavailable.has(line.item_id),
  }));
  const unavailableCount = views.filter((view) => view.unavailable).length;
  const amounts = summary?.kind === 'ready' ? { subtotal: summary.subtotal, fee: summary.fee, total: summary.total } : null;

  return (
    <CartView
      lang={lang}
      links={links}
      phase={!ready || terms.kind === 'loading' ? 'loading' : terms.kind === 'error' ? 'error' : lines.length === 0 ? 'empty' : 'ready'}
      lines={views}
      count={lines.reduce((sum, line) => sum + line.quantity, 0)}
      summary={amounts}
      pricesNotChecked={refresh.report.failed && !refresh.running}
      blocked={unavailableCount > 0 || amounts === null}
      unavailableCount={unavailableCount}
      onQuantity={(itemId, quantity) => store.setQuantity(itemId, quantity)}
      onRemove={(itemId) => store.remove(itemId)}
      onRetry={retryTerms}
      onRetryPrices={refresh.retry}
    />
  );
}
