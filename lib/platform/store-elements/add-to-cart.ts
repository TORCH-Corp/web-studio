import type { CardData } from '@/lib/platform/store-elements/card-data';
import { getCartStore } from '@/lib/platform/store-elements/cart-store';

/**
 * "Add to cart" on a card without variants: one of the product, into the
 * connected cart (W5). With no cart connected this throws
 * CartStoreNotConnectedError, which is the right failure: nothing is added
 * and the console says why.
 */
export function addToCart(card: CardData): void {
  getCartStore().add({
    item_id: card.id,
    quantity: 1,
    snapshot: { name: card.name, name_ar: card.name_ar, price: card.price, image: card.imageUrl },
  });
}
