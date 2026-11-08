'use client';

/**
 * Product Card Settings (part 2, session W4; PRD V1.1 "Store elements and sections")
 *
 * Settings panel for a product card shown alone: the product it shows, picked
 * from the site's catalogue by name. In the builder's own controls (owner
 * decision 4: no redesign).
 */

import React, { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import SettingsPanel from './SettingsPanel';
import { fetchPickerProducts, type PickerProduct } from '@/lib/platform/store-elements/builder-client';
import { readProductCardSettings } from '@/lib/platform/store-elements/settings';
import { useDebounce } from '@/hooks/use-debounce';
import type { Layer } from '@/types';

interface Props {
  layer: Layer | null;
  onLayerUpdate: (layerId: string, updates: Partial<Layer>) => void;
}

const SEARCH_DELAY_MS = 300;

export default function ProductCardSettings({ layer, onLayerUpdate }: Props) {
  const [isOpen, setIsOpen] = useState(true);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [search, setSearch] = useState('');
  const debounced = useDebounce(search, SEARCH_DELAY_MS);
  const [products, setProducts] = useState<PickerProduct[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isCard = layer?.name === 'productCard';

  // The list is asked for while the picker is open, and again as the search changes.
  useEffect(() => {
    if (!isCard || !pickerOpen) return;
    const controller = new AbortController();
    setError(null);
    fetchPickerProducts(debounced.trim(), 1, controller.signal)
      .then((result) => setProducts(result.products))
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setProducts(null);
        setError(reason instanceof Error ? reason.message : 'The products could not be read');
      });
    return () => controller.abort();
  }, [isCard, pickerOpen, debounced]);

  if (!layer || !isCard) return null;

  const { product } = readProductCardSettings(layer);

  const choose = (picked: PickerProduct | null) => {
    onLayerUpdate(layer.id, {
      settings: {
        ...layer.settings,
        store: { ...layer.settings?.store, productCard: { product: picked ? { id: picked.id, name: picked.name, name_ar: picked.name_ar } : null } },
      },
    });
    setPickerOpen(false);
    setSearch('');
  };

  return (
    <SettingsPanel
      title="Product card" isOpen={isOpen}
      onToggle={() => setIsOpen(!isOpen)}
    >
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-3 items-center">
          <Label variant="muted">Product</Label>
          <div className="col-span-2">
            <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline" size="sm"
                  className="w-full justify-between font-normal"
                >
                  <span className="truncate">{product ? (product.name || 'Chosen product') : 'Choose a product'}</span>
                  <Icon name="chevronDown" className="size-3.5 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-64 p-2 flex flex-col gap-2">
                <Input
                  value={search} onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search by name" disableKeyboardStep
                />
                <div className="flex flex-col max-h-60 overflow-y-auto">
                  {(products ?? []).map((candidate) => (
                    <button
                      key={candidate.id}
                      type="button"
                      className="flex flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent cursor-pointer"
                      onClick={() => choose(candidate)}
                    >
                      <span className="truncate w-full">{candidate.name}</span>
                      <span className="text-muted-foreground">{candidate.sku}</span>
                    </button>
                  ))}
                  {products === null && !error && <div className="px-2 py-2 text-xs text-muted-foreground">Loading products...</div>}
                  {products !== null && products.length === 0 && <div className="px-2 py-2 text-xs text-muted-foreground">No product found</div>}
                  {error && <div className="px-2 py-2 text-xs text-destructive">{error}</div>}
                </div>
              </PopoverContent>
            </Popover>
          </div>
        </div>
        {product && (
          <Button
            variant="ghost" size="xs"
            className="self-start" onClick={() => choose(null)}
          >
            Clear
          </Button>
        )}
        <p className="text-xs text-muted-foreground">A card with no product chosen is not shown on the published page.</p>
      </div>
    </SettingsPanel>
  );
}
