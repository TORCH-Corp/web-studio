import type { StoreProduct, StoreVariant } from '@/lib/platform/catalogue-rules';
import type { CardData } from '@/lib/platform/store-elements/card-data';
import { CartFullError, getCartStore, type CartLineInput, type CartLineSnapshot } from '@/lib/platform/store-elements/cart-store';

/** `added`, or `full`: the cart holds as many different items as a checkout takes, and this one is not in it. */
export type AddResult = 'added' | 'full';

/**
 * What the cart shows for a product, or for the variant of it a line sells. The cart element reads this again from
 * the catalogue when it opens, so a line follows the price (session W6).
 */
export function snapshotFor(product: StoreProduct, variant: StoreVariant | null): CartLineSnapshot {
  const price = variant?.price ?? product.price;
  const image = variant ? variant.image : product.images[0];
  return {
    name: product.name,
    name_ar: product.name_ar,
    axes: (variant?.axes ?? []).map((axis) => ({ name: axis.name, name_ar: axis.name_ar, option: axis.option, option_ar: axis.option_ar })),
    price: { amount: price.amount, currency: price.currency },
    image: image?.url ?? null,
    unit: product.unit ? { name: product.unit.name, symbol: product.unit.symbol } : null,
  };
}

/**
 * The cart line for a product, or for the variant picked on it: the line's item is the variant's own id when there
 * is one (that is what Sales prices and the order names), the product's otherwise. The snapshot is what the cart
 * shows; the checkout reads prices again (PRD V1.1).
 */
export function lineForProduct(product: StoreProduct, variant: StoreVariant | null, quantity: number): CartLineInput {
  if (variant && (!variant.available || !variant.price)) throw new Error(`Variant ${variant.id} cannot be bought and is not put in the cart`);
  return { item_id: variant ? variant.id : product.id, product_id: product.id, quantity, snapshot: snapshotFor(product, variant) };
}

function add(line: CartLineInput): AddResult {
  try {
    getCartStore().add(line);
    return 'added';
  } catch (error) {
    // A full cart is a state the buyer is told about; with no cart connected (CartStoreNotConnectedError) it
    // throws, which is the right failure: nothing is added and the console says why.
    if (error instanceof CartFullError) return 'full';
    throw error;
  }
}

/** "Add to cart" on the product page: the product, or the picked variant, in the quantity chosen. */
export function addProductToCart(product: StoreProduct, variant: StoreVariant | null, quantity: number): AddResult {
  return add(lineForProduct(product, variant, quantity));
}

/** "Add to cart" on a card without variants: one of the product, into the connected cart. */
export function addToCart(card: CardData): AddResult {
  return add({
    item_id: card.id,
    product_id: card.id,
    quantity: 1,
    snapshot: { name: card.name, name_ar: card.name_ar, axes: [], price: card.price, image: card.imageUrl, unit: card.unit },
  });
}
