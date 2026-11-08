/**
 * Store Elements Templates (part 2, session W4; PRD V1.1 "Store elements and sections")
 *
 * The Store category of the element library: the product grid, the product
 * card, the product page, the cart indicator, and the cart, checkout and
 * order confirmation (session W6). Each is a leaf the builder styles like any
 * other layer (its wrapper); what it draws inside is the store pages' own
 * design (lib/platform/store-elements).
 *
 * The icons are the ones the builder's icon set already has: it has no cart or
 * bag icon, and the fork does not add to ycode's set for three entries.
 */

import { BlockTemplate } from '@/types';
import { PRODUCT_GRID_DEFAULTS } from '@/lib/platform/store-elements/settings';

export const storeTemplates: Record<string, BlockTemplate> = {
  productGrid: {
    icon: 'grid',
    name: 'Product grid',
    template: {
      name: 'productGrid',
      classes: ['w-full'],
      settings: {
        tag: 'div',
        store: { productGrid: { ...PRODUCT_GRID_DEFAULTS, categories: [] } },
      },
      design: {
        sizing: {
          isActive: true,
          width: '100%',
        },
      },
    },
  },

  productCard: {
    icon: 'cube',
    name: 'Product card',
    template: {
      name: 'productCard',
      classes: ['w-full'],
      settings: {
        tag: 'div',
        store: { productCard: { product: null } },
      },
      design: {
        sizing: {
          isActive: true,
          width: '100%',
        },
      },
    },
  },

  productDetail: {
    icon: 'columns',
    name: 'Product page',
    template: {
      name: 'productDetail',
      classes: ['w-full'],
      settings: {
        tag: 'div',
        store: { productDetail: { product: null } },
      },
      design: {
        sizing: {
          isActive: true,
          width: '100%',
        },
      },
    },
  },

  cartIndicator: {
    icon: 'box',
    name: 'Cart indicator',
    template: {
      name: 'cartIndicator',
      classes: ['w-fit'],
      settings: {
        tag: 'div',
      },
    },
  },

  cart: {
    icon: 'rows',
    name: 'Cart',
    template: {
      name: 'cart',
      classes: ['w-full'],
      settings: {
        tag: 'div',
      },
      design: {
        sizing: {
          isActive: true,
          width: '100%',
        },
      },
    },
  },

  checkout: {
    icon: 'form',
    name: 'Checkout',
    template: {
      name: 'checkout',
      classes: ['w-full'],
      settings: {
        tag: 'div',
      },
      design: {
        sizing: {
          isActive: true,
          width: '100%',
        },
      },
    },
  },

  orderConfirmation: {
    icon: 'check',
    name: 'Order confirmation',
    template: {
      name: 'orderConfirmation',
      classes: ['w-full'],
      settings: {
        tag: 'div',
      },
      design: {
        sizing: {
          isActive: true,
          width: '100%',
        },
      },
    },
  },
};
