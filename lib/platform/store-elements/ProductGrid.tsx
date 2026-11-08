'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cardOf, nameFor, type CardData } from '@/lib/platform/store-elements/card-data';
import { addToCart } from '@/lib/platform/store-elements/add-to-cart';
import { ProductGridView, type ChipData, type GridPhase } from '@/lib/platform/store-elements/GridView';
import type { LinkLocale } from '@/lib/platform/store-elements/links';
import type { ProductGridSettings } from '@/lib/platform/store-elements/settings';
import { fetchCategories, fetchProducts } from '@/lib/platform/store-elements/store-client';
import type { StoreLang } from '@/lib/platform/store-elements/strings';
import { isUuid } from '@/lib/platform/store-query';

/** How long the search field rests before the grid searches (Enter searches at once). */
const SEARCH_DELAY_MS = 300;
/** Skeleton cards while loading: the handoff draws eight. */
const SKELETON_COUNT = 8;

interface Filters {
  category: string | null;
  q: string;
}

type Data =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'hidden' }
  | { kind: 'ready'; cards: CardData[]; total: number; page: number; loadingMore: boolean; moreFailed: boolean };

/** The page's own ?category= and ?q=, read once the page is in the browser. */
function readUrl(honourCategory: boolean): Filters {
  const params = new URLSearchParams(window.location.search);
  const category = params.get('category');
  return {
    category: honourCategory && category && isUuid(category) ? category.toLowerCase() : null,
    q: params.get('q')?.trim() ?? '',
  };
}

function writeUrl(filters: Filters, honourCategory: boolean): void {
  const url = new URL(window.location.href);
  if (honourCategory) {
    if (filters.category) url.searchParams.set('category', filters.category);
    else url.searchParams.delete('category');
  }
  if (filters.q) url.searchParams.set('q', filters.q);
  else url.searchParams.delete('q');
  window.history.replaceState(window.history.state, '', url);
}

interface Props {
  settings: ProductGridSettings;
  lang: StoreLang;
  locale?: LinkLocale | null;
}

/**
 * The product grid on a published page: the live catalogue from the store API (part 2, W2) with the element's
 * settings and the page's ?category= and ?q=. The server and the first browser render are the skeleton, so the
 * cached page and the hydrated one agree; the URL is read, and the first page asked for, once the page is in
 * the browser. A store that does not sell renders nothing.
 */
export default function ProductGrid({ settings, lang, locale }: Props) {
  const { categories, pageSize, honourUrlCategory } = settings;
  const categoriesKey = categories.join(',');
  const [filters, setFilters] = useState<Filters | null>(null);
  const [typed, setTyped] = useState('');
  const [data, setData] = useState<Data>({ kind: 'loading' });
  const [chipSource, setChipSource] = useState<Array<{ id: string; name: string; name_ar: string | null }>>([]);
  const [attempt, setAttempt] = useState(0);
  const rest = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // The search timer fires later than the render that started it, so it reads the filters as they are then.
  const latest = useRef<Filters | null>(null);
  useEffect(() => {
    latest.current = filters;
  }, [filters]);

  useEffect(() => {
    const initial = readUrl(honourUrlCategory);
    setFilters(initial);
    setTyped(initial.q);
  }, [honourUrlCategory]);

  // "Load more" in flight: it belongs to the filters it was asked under, so it is let go when they change or the grid goes.
  const more = useRef<AbortController | null>(null);

  useEffect(() => () => {
    clearTimeout(rest.current);
    more.current?.abort();
  }, []);

  // The category chips: the site's store categories, narrowed to the element's own when it names some.
  useEffect(() => {
    if (!settings.showCategoryFilter) return;
    const controller = new AbortController();
    fetchCategories(controller.signal)
      .then((result) => {
        if (result.kind === 'ok') setChipSource(result.value.data);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) console.error('[store] the categories could not be read', error);
      });
    return () => controller.abort();
  }, [settings.showCategoryFilter, attempt]);

  // The first page, again whenever the category or the search changes.
  useEffect(() => {
    if (!filters) return;
    more.current?.abort();
    const controller = new AbortController();
    setData({ kind: 'loading' });
    fetchProducts({ page: 1, pageSize, category: filters.category, categories, q: filters.q }, controller.signal)
      .then((result) => {
        if (result.kind === 'not_selling') return setData({ kind: 'hidden' });
        setData({ kind: 'ready', cards: result.value.data.map(cardOf), total: result.value.meta.total, page: 1, loadingMore: false, moreFailed: false });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        console.error('[store] the products could not be read', error);
        setData({ kind: 'error' });
      });
    return () => controller.abort();
    // `categories` is read through its key: a new array with the same ids is not a new request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, pageSize, categoriesKey, attempt]);

  const apply = useCallback((next: Filters) => {
    clearTimeout(rest.current);
    setFilters(next);
    writeUrl(next, honourUrlCategory);
  }, [honourUrlCategory]);

  const onTyped = (value: string) => {
    setTyped(value);
    clearTimeout(rest.current);
    rest.current = setTimeout(() => {
      const q = value.trim();
      if (latest.current && q !== latest.current.q) apply({ ...latest.current, q });
    }, SEARCH_DELAY_MS);
  };

  const onSubmitSearch = () => {
    const q = typed.trim();
    if (filters && q !== filters.q) apply({ ...filters, q });
    else clearTimeout(rest.current);
  };

  const onLoadMore = () => {
    if (data.kind !== 'ready' || !filters || data.loadingMore) return;
    const page = data.page + 1;
    setData({ ...data, loadingMore: true, moreFailed: false });
    const controller = new AbortController();
    more.current = controller;
    fetchProducts({ page, pageSize, category: filters.category, categories, q: filters.q }, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        if (result.kind === 'not_selling') return setData({ kind: 'hidden' });
        setData((current) => current.kind !== 'ready' ? current : {
          ...current,
          cards: [...current.cards, ...result.value.data.map(cardOf)],
          total: result.value.meta.total,
          page,
          loadingMore: false,
        });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        console.error('[store] the next page of products could not be read', error);
        setData((current) => current.kind === 'ready' ? { ...current, loadingMore: false, moreFailed: true } : current);
      });
  };

  const chips: ChipData[] = useMemo(() => {
    const wanted = categoriesKey ? new Set(categoriesKey.split(',')) : null;
    return chipSource
      .filter((category) => !wanted || wanted.has(category.id))
      .map((category) => ({ id: category.id, name: nameFor(category, lang) }));
  }, [chipSource, categoriesKey, lang]);

  if (data.kind === 'hidden') return null;

  const phase: GridPhase = data.kind === 'ready'
    ? { kind: 'ready', cards: data.cards, hasMore: data.cards.length < data.total, loadingMore: data.loadingMore, moreFailed: data.moreFailed }
    : data;

  return (
    <ProductGridView
      lang={lang}
      locale={locale}
      phase={phase}
      showSearch={settings.showSearch}
      showCategoryFilter={settings.showCategoryFilter}
      chips={chips}
      selectedCategory={filters?.category ?? null}
      typed={typed}
      query={filters?.q ?? ''}
      skeletons={Math.min(pageSize, SKELETON_COUNT)}
      onTyped={onTyped}
      onSubmitSearch={onSubmitSearch}
      onSelectCategory={(category) => filters && apply({ ...filters, category })}
      onClearSearch={() => {
        setTyped('');
        if (filters) apply({ ...filters, q: '' });
      }}
      onLoadMore={onLoadMore}
      onRetry={() => setAttempt((n) => n + 1)}
      onAdd={addToCart}
    />
  );
}
