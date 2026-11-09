'use client';

import React, { useEffect, useState } from 'react';
import { ErrorAlert } from '@/lib/platform/store-elements/CardView';
import { categoryCardsOf, type CategoryCardData } from '@/lib/platform/store-elements/category-cards';
import { CategoryCardsSkeleton, CategoryCardsView } from '@/lib/platform/store-elements/CategoryCardsView';
import type { StoreLinks } from '@/lib/platform/store-elements/links';
import { fetchCategories } from '@/lib/platform/store-elements/store-client';
import type { StoreLang } from '@/lib/platform/store-elements/strings';

type State = { kind: 'loading' } | { kind: 'error' } | { kind: 'hidden' } | { kind: 'ready'; categories: CategoryCardData[] };

/**
 * The category cards on a published page: the shop home's categories from the store API (part 2, W2), read once
 * the page is in the browser. The server and the first browser render are the skeleton, so the cached page and
 * the hydrated one agree. A store that does not sell, or one with nothing in any category, renders nothing; a
 * catalogue that cannot be read shows the designed error with a way to try again.
 */
export default function CategoryCards({ lang, links }: { lang: StoreLang; links: StoreLinks }) {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setState({ kind: 'loading' });
    fetchCategories(controller.signal)
      .then((result) => {
        if (result.kind === 'not_selling') return setState({ kind: 'hidden' });
        const categories = categoryCardsOf(result.value.data);
        setState(categories.length > 0 ? { kind: 'ready', categories } : { kind: 'hidden' });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        console.error('[store] the categories could not be read', error);
        setState({ kind: 'error' });
      });
    return () => controller.abort();
  }, [attempt]);

  if (state.kind === 'hidden') return null;
  if (state.kind === 'loading') return <CategoryCardsSkeleton lang={lang} />;
  if (state.kind === 'error') return <ErrorAlert lang={lang} onRetry={() => setAttempt((n) => n + 1)} />;
  return (
    <CategoryCardsView
      categories={state.categories} lang={lang}
      links={links}
    />
  );
}
