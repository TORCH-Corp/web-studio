'use client';

/**
 * Product Grid Settings (part 2, session W4; PRD V1.1 "Store elements and sections")
 *
 * Settings panel for the product grid: which categories it lists (from the
 * site's store categories), the page size, and whether it shows the search
 * field, the category filter and the page's ?category=. In the builder's own
 * controls (owner decision 4: no redesign).
 */

import React, { useCallback, useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import Icon from '@/components/ui/icon';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import SettingsPanel from './SettingsPanel';
import { fetchPickerCategories, type PickerCategory } from '@/lib/platform/store-elements/builder-client';
import { clampPageSize, readProductGridSettings, type ProductGridSettings } from '@/lib/platform/store-elements/settings';
import { MAX_PAGE_SIZE } from '@/lib/platform/store-query';
import type { Layer } from '@/types';

interface Props {
  layer: Layer | null;
  onLayerUpdate: (layerId: string, updates: Partial<Layer>) => void;
}

export default function ProductGridSettings({ layer, onLayerUpdate }: Props) {
  const [isOpen, setIsOpen] = useState(true);
  const [categories, setCategories] = useState<PickerCategory[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const settings = readProductGridSettings(layer);
  const [pageSizeInput, setPageSizeInput] = useState(String(settings.pageSize));
  const isGrid = layer?.name === 'productGrid';

  // The categories are asked for once the panel is for a grid, and again for another grid.
  useEffect(() => {
    if (!isGrid) return;
    const controller = new AbortController();
    setError(null);
    fetchPickerCategories(controller.signal)
      .then(setCategories)
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setCategories(null);
        setError(reason instanceof Error ? reason.message : 'The categories could not be read');
      });
    return () => controller.abort();
  }, [isGrid, layer?.id]);

  // Another grid, another page size.
  useEffect(() => {
    setPageSizeInput(String(settings.pageSize));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layer?.id]);

  const update = useCallback(
    (patch: Partial<ProductGridSettings>) => {
      if (!layer) return;
      onLayerUpdate(layer.id, {
        settings: {
          ...layer.settings,
          store: { ...layer.settings?.store, productGrid: { ...settings, ...patch } },
        },
      });
    },
    [layer, onLayerUpdate, settings],
  );

  const toggleCategory = (id: string) => {
    const next = settings.categories.includes(id) ? settings.categories.filter((chosen) => chosen !== id) : [...settings.categories, id];
    update({ categories: next });
  };

  if (!layer || !isGrid) return null;

  const names = new Map((categories ?? []).map((category) => [category.id, category.name]));
  const summary = settings.categories.length === 0
    ? 'All categories'
    : settings.categories.length === 1
      ? (names.get(settings.categories[0]) ?? '1 category')
      : `${settings.categories.length} categories`;

  return (
    <SettingsPanel
      title="Product grid" isOpen={isOpen}
      onToggle={() => setIsOpen(!isOpen)}
    >
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-3 items-center">
          <Label variant="muted">Categories</Label>
          <div className="col-span-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline" size="sm"
                  className="w-full justify-between font-normal"
                >
                  <span className="truncate">{summary}</span>
                  <Icon name="chevronDown" className="size-3.5 shrink-0 opacity-50" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-(--radix-dropdown-menu-trigger-width)">
                {(categories ?? []).map((category) => (
                  <DropdownMenuCheckboxItem
                    key={category.id}
                    checked={settings.categories.includes(category.id)}
                    onCheckedChange={() => toggleCategory(category.id)}
                    onSelect={(event) => event.preventDefault()}
                  >
                    {category.name}
                  </DropdownMenuCheckboxItem>
                ))}
                {categories === null && !error && <div className="px-2 py-2 text-xs text-muted-foreground">Loading categories...</div>}
                {categories !== null && categories.length === 0 && <div className="px-2 py-2 text-xs text-muted-foreground">The store has no categories</div>}
                {error && <div className="px-2 py-2 text-xs text-destructive">{error}</div>}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        <p className="text-xs text-muted-foreground -mt-1">With none chosen the grid lists everything the store sells.</p>

        <div className="grid grid-cols-3 items-center">
          <Label variant="muted" title={`Products per page, 1 to ${MAX_PAGE_SIZE}`}>Page size</Label>
          <div className="col-span-2 *:w-full">
            <Input
              stepper
              step="1"
              min="1"
              max={String(MAX_PAGE_SIZE)}
              inputMode="numeric"
              value={pageSizeInput}
              onChange={(event) => {
                const raw = event.target.value.replace(/[^0-9]/g, '');
                setPageSizeInput(raw);
                const value = parseInt(raw, 10);
                if (!Number.isNaN(value) && value >= 1 && value <= MAX_PAGE_SIZE) update({ pageSize: value });
              }}
              onBlur={() => {
                const value = clampPageSize(parseInt(pageSizeInput, 10));
                setPageSizeInput(String(value));
                if (value !== settings.pageSize) update({ pageSize: value });
              }}
            />
          </div>
        </div>

        <div className="flex items-center justify-between gap-2">
          <Label variant="muted">Show search</Label>
          <Checkbox checked={settings.showSearch} onCheckedChange={(checked) => update({ showSearch: checked === true })} />
        </div>
        <div className="flex items-center justify-between gap-2">
          <Label variant="muted">Show category filter</Label>
          <Checkbox checked={settings.showCategoryFilter} onCheckedChange={(checked) => update({ showCategoryFilter: checked === true })} />
        </div>
        <div className="flex items-center justify-between gap-2">
          <Label variant="muted" title="The page's ?category= selects that category">Use the URL category</Label>
          <Checkbox checked={settings.honourUrlCategory} onCheckedChange={(checked) => update({ honourUrlCategory: checked === true })} />
        </div>
      </div>
    </SettingsPanel>
  );
}
