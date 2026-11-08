'use client';

/**
 * Product Page Settings (part 2, session W5; PRD V1.1 "Store elements and sections"): the product the element
 * shows when it is on a page that is not the product page. On the page with the product role the element shows
 * the item the address names, and this choice is not used.
 */

import React from 'react';

import ChosenProductSettings from './ChosenProductSettings';
import type { Layer } from '@/types';

interface Props {
  layer: Layer | null;
  onLayerUpdate: (layerId: string, updates: Partial<Layer>) => void;
}

export default function ProductDetailSettings({ layer, onLayerUpdate }: Props) {
  return (
    <ChosenProductSettings
      layer={layer} onLayerUpdate={onLayerUpdate}
      element="productDetail" title="Product page"
      hint="On the page set as the product page, the element shows the item in the address. Anywhere else it shows this product, and nothing when none is chosen."
    />
  );
}
