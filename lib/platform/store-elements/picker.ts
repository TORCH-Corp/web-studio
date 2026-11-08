/**
 * What the product page's picker and gallery decide (part 2, session W5; PRD
 * V1.1 "Store elements and sections", notebook decisions 14 and 16f), apart
 * from how they look.
 *
 * A product with variants shows one row of chips per axis (`axes_summary`);
 * the chosen options name one variant, and that variant is what goes to the
 * cart. A variant that cannot be bought (inactive, no price, no rate) cannot be
 * picked, and the picker says so on every option that has no variant to buy:
 *
 * - An option is `unavailable` when no variant that can be bought has it. The
 *   page opens on the cheapest variant that can be bought, so the price the
 *   buyer first sees is the card's "from" price.
 * - Picking an option that goes with the other axes' current choice changes
 *   that axis only. Picking one that does not (small comes only in black, and
 *   white is chosen) moves the other axes to the nearest variant that has it,
 *   instead of leaving the buyer on a combination that cannot be bought or
 *   making them undo their choice first.
 * - The gallery shows the variant's own image when it has one, else the
 *   product's (`variant.image` is already that fallback, decision 16f); the
 *   thumbnails are every distinct image of the product and of its variants.
 *
 * Kept free of Next and React imports so it runs under `node --test`.
 */

import type { StoreAxis, StoreImage, StoreProduct, StoreVariant } from '@/lib/platform/catalogue-rules';
import { compareAmounts } from '@/lib/platform/store-money';

/** The chosen option of each axis: specification id → option id. */
export type Selection = Record<string, string>;

export interface OptionState {
  id: string;
  label: string;
  label_ar: string | null;
  selected: boolean;
  /** No variant that can be bought has this option. */
  unavailable: boolean;
}

export interface OptionRow {
  axis: StoreAxis;
  options: OptionState[];
}

const buyable = (variants: StoreVariant[]) => variants.filter((variant) => variant.available && variant.price);

const optionOf = (variant: StoreVariant, specificationId: string): string | undefined =>
  variant.axes.find((axis) => axis.specification_id === specificationId)?.option_id;

const selectionOf = (variant: StoreVariant): Selection => Object.fromEntries(variant.axes.map((axis) => [axis.specification_id, axis.option_id]));

/** The variant that has exactly the chosen options, or null (no such variant, an axis not chosen, a product without variants). */
export function variantFor(product: Pick<StoreProduct, 'variants' | 'axes_summary'>, selection: Selection): StoreVariant | null {
  if (product.variants.length === 0) return null;
  return (
    product.variants.find(
      (variant) =>
        variant.axes.length === product.axes_summary.length &&
        variant.axes.every((axis) => selection[axis.specification_id] === axis.option_id),
    ) ?? null
  );
}

function cheapest(variants: StoreVariant[]): StoreVariant | null {
  let best: StoreVariant | null = null;
  for (const variant of buyable(variants)) {
    if (!best || compareAmounts(variant.price!.amount, best.price!.amount) < 0) best = variant;
  }
  return best;
}

/** What the page opens on: the cheapest variant that can be bought; nothing for a product without variants. */
export function initialSelection(product: Pick<StoreProduct, 'variants'>): Selection {
  const first = cheapest(product.variants);
  return first ? selectionOf(first) : {};
}

/** The rows of chips, with the chosen option marked and the options that cannot be bought. */
export function optionRows(product: Pick<StoreProduct, 'variants' | 'axes_summary'>, selection: Selection): OptionRow[] {
  if (product.variants.length === 0) return [];
  const available = buyable(product.variants);
  return product.axes_summary.map((axis) => ({
    axis,
    options: axis.options.map((option) => ({
      id: option.id,
      label: option.label,
      label_ar: option.label_ar,
      selected: selection[axis.id] === option.id,
      unavailable: !available.some((variant) => optionOf(variant, axis.id) === option.id),
    })),
  }));
}

/** The selection after the buyer picks `optionId` on `specificationId`; the same selection when that option cannot be bought or is not on the axis. */
export function selectOption(
  product: Pick<StoreProduct, 'variants' | 'axes_summary'>,
  selection: Selection,
  specificationId: string,
  optionId: string,
): Selection {
  const axis = product.axes_summary.find((candidate) => candidate.id === specificationId);
  if (!axis || !axis.options.some((option) => option.id === optionId)) return selection;
  const candidates = buyable(product.variants).filter((variant) => optionOf(variant, specificationId) === optionId);
  if (candidates.length === 0) return selection;

  // The variant that keeps the most of the other choices; of those, the cheapest, then the first listed.
  let best = candidates[0];
  let bestKept = -1;
  for (const candidate of candidates) {
    const kept = candidate.axes.filter((a) => a.specification_id !== specificationId && selection[a.specification_id] === a.option_id).length;
    const better = kept > bestKept || (kept === bestKept && compareAmounts(candidate.price!.amount, best.price!.amount) < 0);
    if (better) {
      best = candidate;
      bestKept = kept;
    }
  }
  return selectionOf(best);
}

export interface Thumb {
  image: StoreImage;
  /** The image on show. */
  on: boolean;
}

export interface Gallery {
  main: StoreImage | null;
  /** Empty when the product has one image or none. */
  thumbs: Thumb[];
}

/**
 * The picture on show and the thumbnails. `pickedDocumentId` is a thumbnail the
 * buyer clicked; it holds only while it is one of this product's images (a
 * stale one falls back to the variant's).
 */
export function galleryFor(product: Pick<StoreProduct, 'images' | 'variants'>, variant: StoreVariant | null, pickedDocumentId: string | null): Gallery {
  const all: StoreImage[] = [];
  const add = (image: StoreImage | null | undefined) => {
    if (image && !all.some((known) => known.document_id === image.document_id)) all.push(image);
  };
  for (const image of product.images) add(image);
  for (const each of product.variants) add(each.image);

  const picked = pickedDocumentId ? all.find((image) => image.document_id === pickedDocumentId) : undefined;
  const main = picked ?? variant?.image ?? product.images[0] ?? null;
  const thumbs = all.length > 1 ? all.map((image) => ({ image, on: image.document_id === main?.document_id })) : [];
  return { main, thumbs };
}
