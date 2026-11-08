'use client';

/**
 * Product Card Settings (part 2, session W4; PRD V1.1 "Store elements and sections"): the product a card shown
 * alone displays.
 */

import React from 'react';

import ChosenProductSettings from './ChosenProductSettings';
import type { Layer } from '@/types';

interface Props {
  layer: Layer | null;
  onLayerUpdate: (layerId: string, updates: Partial<Layer>) => void;
}

export default function ProductCardSettings({ layer, onLayerUpdate }: Props) {
  return (
    <ChosenProductSettings
      layer={layer} onLayerUpdate={onLayerUpdate}
      element="productCard" title="Product card"
      hint="A card with no product chosen is not shown on the published page."
    />
  );
}
