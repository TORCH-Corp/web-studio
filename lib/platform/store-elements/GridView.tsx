'use client';

import React, { useId } from 'react';
import clsx from 'clsx';
import type { AddResult } from '@/lib/platform/store-elements/add-to-cart';
import type { CardData } from '@/lib/platform/store-elements/card-data';
import { CardSkeleton, ErrorAlert, ProductCardView } from '@/lib/platform/store-elements/CardView';
import { GridIcon, SearchIcon, SearchOffIcon } from '@/lib/platform/store-elements/icons';
import type { StoreLinks } from '@/lib/platform/store-elements/links';
import { STORE_STRINGS, type StoreLang } from '@/lib/platform/store-elements/strings';

export interface ChipData {
  id: string;
  name: string;
}

/** What the grid shows, whichever way the data arrived (the store API, or the canvas's samples). */
export type GridPhase =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'ready'; cards: CardData[]; hasMore: boolean; loadingMore: boolean; moreFailed: boolean };

interface GridViewProps {
  lang: StoreLang;
  links: StoreLinks;
  phase: GridPhase;
  showSearch: boolean;
  showCategoryFilter: boolean;
  /** The category chips after "All"; none hides the row. */
  chips: ChipData[];
  selectedCategory: string | null;
  /** The search field's text, and the search the grid is showing (for the empty state). */
  typed: string;
  query: string;
  /** How many skeleton cards to draw while loading. */
  skeletons: number;
  onTyped: (value: string) => void;
  onSubmitSearch: () => void;
  onSelectCategory: (id: string | null) => void;
  onClearSearch: () => void;
  onLoadMore: () => void;
  onRetry: () => void;
  onAdd: (card: CardData) => AddResult | void;
}

function Empty({ icon, title, text, action }: { icon: React.ReactNode; title: string; text: string; action?: { label: string; run: () => void } }) {
  return (
    <div className="ws-empty">
      <div className="ws-empty-icon">{icon}</div>
      <h3 className="ws-empty-title">{title}</h3>
      <p className="ws-empty-text">{text}</p>
      {action && <button
        className="ws-btn ws-btn-outline" type="button"
        onClick={action.run}
                 >{action.label}</button>}
    </div>
  );
}

/**
 * The product grid as handoff/store draws it (browse-products-*, section-products-*): the search field and
 * category chips above the cards, the skeleton while loading, the empty-category and no-results states, and,
 * built from the same patterns (decision 16g), the catalogue-failure state, "Load more" and an empty store.
 */
export function ProductGridView(props: GridViewProps) {
  const { lang, links, phase, chips, selectedCategory, typed, query } = props;
  const t = STORE_STRINGS[lang];
  const searchId = useId();
  const hasChips = props.showCategoryFilter && chips.length > 0;

  let body: React.ReactNode;
  if (phase.kind === 'loading') {
    body = (
      <>
        <p className="ws-sr" role="status">{t.loading}</p>
        <div className="ws-grid" aria-hidden="true">
          {Array.from({ length: props.skeletons }, (_, i) => <CardSkeleton key={i} />)}
        </div>
      </>
    );
  } else if (phase.kind === 'error') {
    body = <ErrorAlert lang={lang} onRetry={props.onRetry} />;
  } else if (phase.cards.length === 0) {
    const category = chips.find((chip) => chip.id === selectedCategory)?.name ?? null;
    if (query) {
      // A search that matches nothing, whatever category is selected.
      body = (
        <Empty
          icon={<SearchOffIcon />}
          title={t.noResultsTitle(query)}
          text={t.noResultsText}
          action={{ label: t.clearSearch, run: props.onClearSearch }}
        />
      );
    } else if (selectedCategory) {
      body = (
        <Empty
          icon={<GridIcon />}
          title={t.emptyCategoryTitle(category)}
          text={t.emptyCategoryText}
          action={{ label: t.showAll, run: () => props.onSelectCategory(null) }}
        />
      );
    } else {
      body = (
        <Empty
          icon={<GridIcon />}
          title={t.emptyStoreTitle}
          text={t.emptyStoreText}
        />
      );
    }
  } else {
    body = (
      <>
        <div className="ws-grid">
          {phase.cards.map((card) => (
            <ProductCardView
              key={card.id} card={card}
              lang={lang} href={links.product(card.id)}
              onAdd={props.onAdd}
            />
          ))}
        </div>
        {phase.moreFailed && <ErrorAlert lang={lang} onRetry={props.onLoadMore} />}
        {phase.hasMore && !phase.moreFailed && (
          <div className="ws-more">
            <button
              className="ws-btn ws-btn-outline" type="button"
              disabled={phase.loadingMore} aria-busy={phase.loadingMore}
              onClick={props.onLoadMore}
            >{t.loadMore}</button>
          </div>
        )}
      </>
    );
  }

  return (
    <div className="ws-grid-root">
      {(props.showSearch || hasChips) && (
        <div className="ws-toolbar">
          {props.showSearch && (
            <form
              className="ws-search" role="search"
              onSubmit={(event) => { event.preventDefault(); props.onSubmitSearch(); }}
            >
              <SearchIcon className="ws-search-icon" />
              <label className="ws-sr" htmlFor={searchId}>{t.searchLabel}</label>
              <input
                id={searchId}
                className="ws-input ws-search-input"
                type="search"
                value={typed}
                placeholder={t.searchPlaceholder}
                autoComplete="off"
                onChange={(event) => props.onTyped(event.target.value)}
              />
            </form>
          )}
          {hasChips && (
            <div
              className="ws-chips ws-no-scrollbar" role="group"
              aria-label={t.categoriesLabel}
            >
              <button
                className={clsx('ws-chip', selectedCategory === null && 'ws-chip-on')} type="button"
                aria-pressed={selectedCategory === null} onClick={() => props.onSelectCategory(null)}
              >{t.allCategories}</button>
              {chips.map((chip) => (
                <button
                  key={chip.id} className={clsx('ws-chip', selectedCategory === chip.id && 'ws-chip-on')}
                  type="button" aria-pressed={selectedCategory === chip.id}
                  onClick={() => props.onSelectCategory(chip.id)}
                >{chip.name}</button>
              ))}
            </div>
          )}
        </div>
      )}
      {body}
    </div>
  );
}
