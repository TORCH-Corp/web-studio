'use client';

/**
 * The store role of a page in its settings (part 2, session W5; PRD V1.1 "Store elements and sections"): "Product
 * page" makes the page answer at its own address and one more segment, the item's id, and show that item. In
 * ycode's own page settings controls (owner decision 4: no redesign). W6 adds Cart, Checkout and Confirmation to the
 * list; the roles it offers are lib/platform/store-elements/pages.ts's PANEL_PAGE_KINDS.
 */

import React from 'react';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PANEL_PAGE_KINDS, type StorePageKind } from '@/lib/platform/store-elements/pages';

const LABELS: Record<StorePageKind, string> = {
  product: 'Product page',
  cart: 'Cart page',
  checkout: 'Checkout page',
  confirmation: 'Confirmation page',
};

const NONE = 'none';

interface Props {
  value: StorePageKind | '';
  onChange: (kind: StorePageKind | '') => void;
  /** The page's address as the panel shows it, so the item's id can be shown after it. */
  addressPreview: string;
}

export default function PageStoreRole({ value, onChange, addressPreview }: Props) {
  return (
    <Field>
      <FieldLabel>Store page</FieldLabel>
      <Select
        value={value || NONE}
        onValueChange={(next) => onChange(next === NONE ? '' : (next as StorePageKind))}
      >
        <SelectTrigger className="w-full">
          <SelectValue placeholder="None" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>None</SelectItem>
          {PANEL_PAGE_KINDS.map((kind) => (
            <SelectItem key={kind} value={kind}>{LABELS[kind]}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <FieldDescription>
        {value === 'product'
          ? `Answers at ${addressPreview === '/' ? '' : addressPreview}/{item id} and shows that item. Put a Product page element on it. A site has one product page.`
          : 'Choose a role for the page the store elements lead to. A site has one page for each role.'}
      </FieldDescription>
    </Field>
  );
}
