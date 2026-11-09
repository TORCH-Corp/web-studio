'use client';

import React from 'react';
import { nameFor } from '@/lib/platform/store-elements/card-data';
import { CardMedia } from '@/lib/platform/store-elements/CardView';
import type { CategoryCardData } from '@/lib/platform/store-elements/category-cards';
import type { StoreLinks } from '@/lib/platform/store-elements/links';
import { STORE_STRINGS, type StoreLang } from '@/lib/platform/store-elements/strings';

/** Skeleton cards while the categories load: the handoff draws three categories. */
const SKELETON_COUNT = 3;

interface Props {
  categories: CategoryCardData[];
  lang: StoreLang;
  links: StoreLinks;
}

/**
 * The category cards as handoff/store draws them (browse-home-default, "Shop by category"): three to a row, each a
 * picture over the category's name, each a link to the products page listing that category. A category with no
 * picture has the placeholder tile the product card has. The picture is decoration: the link is read by its name.
 */
export function CategoryCardsView({ categories, lang, links }: Props) {
  const t = STORE_STRINGS[lang];
  return (
    <div className="ws-cats">
      {categories.map((category) => (
        <a
          key={category.id} className="ws-cat-card"
          href={links.category(category.id)} data-category-id={category.id}
        >
          <div aria-hidden="true">
            <CardMedia
              url={category.imageUrl} label={t.categoryImage}
              className="ws-ph-cat"
            />
          </div>
          <span className="ws-cat-name">{nameFor(category, lang)}</span>
        </a>
      ))}
    </div>
  );
}

/** The cards while the categories load: a tile and a line each (the card skeleton's pattern). */
export function CategoryCardsSkeleton({ lang }: { lang: StoreLang }) {
  const t = STORE_STRINGS[lang];
  return (
    <div className="ws-cats" aria-busy="true">
      <p className="ws-sr" role="status">{t.loadingCategories}</p>
      {Array.from({ length: SKELETON_COUNT }, (_, n) => (
        <div
          key={n} className="ws-cat-card"
          aria-hidden="true"
        >
          <div className="ws-sk ws-sk-media ws-ph-cat" />
          <div className="ws-sk ws-sk-line ws-sk-short" />
        </div>
      ))}
    </div>
  );
}
