/**
 * Store sections (part 2, session W4; PRD V1.1 "Store elements and sections"):
 * the ready sections of the Store category of the Layouts tab, built from the
 * store elements as handoff/store draws them (section-products-*,
 * section-featured-default).
 *
 * They are starting points on the design system's own values (Dark text,
 * Primary for the link, the spacing and the type of store/DESIGN_SYSTEM.md);
 * the elements inside follow the site's Primary, Primary soft and Dark colour
 * variables (lib/platform/store-elements/colours.ts), and a section's own
 * layers take whatever the builder gives them. The page layout is ycode's
 * desktop-first breakpoints, so the phone layout starts below its large
 * breakpoint (1024 px), not at the handoff's 960 px.
 *
 * Kept apart from layouts.ts, which the builder's dev layout editor rewrites
 * as text, so the fork's sections survive it and an upstream merge.
 */

import { LayerTemplate } from '@/types';
import { classesToDesign } from '@/lib/tailwind-class-mapper';
import { getTiptapTextContent } from '@/lib/text-format-utils';
import { PRODUCT_GRID_DEFAULTS } from '@/lib/platform/store-elements/settings';

interface LayoutTemplate {
  category: string;
  previewImage?: string;
  template: LayerTemplate;
}

type Extra = Partial<LayerTemplate>;

const CHEVRON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>';

/** A layer from its Tailwind classes, with the design the panel shows derived from them. */
function layer(name: string, classes: string, extra: Extra = {}): LayerTemplate {
  return { name, classes, design: classesToDesign(classes), ...extra };
}

function heading(text: string): LayerTemplate {
  return layer('heading', 'font-[700] text-[28px] leading-[1.3] text-[#17201E] max-lg:text-[22px]', {
    settings: { tag: 'h2' },
    customName: 'Heading',
    restrictions: { editText: true },
    variables: { text: { type: 'dynamic_rich_text', data: { content: getTiptapTextContent(text) } } },
  });
}

/** A section as the store pages have it: a full-width band, a centred container, 20 px between its parts. */
function band(children: LayerTemplate[], customName: string): LayerTemplate {
  return layer('section', 'flex flex-col items-center w-[100%] bg-[#FFFFFF] pt-[48px] pb-[48px] max-lg:pt-[32px] max-lg:pb-[32px]', {
    customName,
    children: [
      layer('div', 'flex flex-col gap-[20px] w-[100%] max-w-[1200px] pl-[32px] pr-[32px] max-lg:pl-[16px] max-lg:pr-[16px]', { customName: 'Container', children }),
    ],
  });
}

function productCard(): LayerTemplate {
  return layer('productCard', 'w-[100%] max-lg:w-[168px] max-lg:shrink-0', {
    settings: { tag: 'div', store: { productCard: { product: null } } },
  });
}

/** "View all": a button with a link to the products page, drawn as the handoff's link. */
function viewAll(): LayerTemplate {
  return layer('button', 'flex flex-row items-center gap-[4px] min-h-[44px] text-[14px] font-[600] text-[#0F766E]', {
    customName: 'View all',
    attributes: { type: 'button' },
    variables: { link: { type: 'url', url: { type: 'dynamic_text', data: { content: '/products' } } } },
    children: [
      layer('text', '', {
        settings: { tag: 'span' },
        restrictions: { editText: true },
        variables: { text: { type: 'dynamic_rich_text', data: { content: getTiptapTextContent('View all') } } },
      }),
      // The handoff's chevron; it turns round on a right to left page
      layer('icon', 'w-[16px] h-[16px] rtl:-scale-x-100', {
        settings: { tag: 'div' },
        customName: 'Chevron',
        variables: { icon: { src: { type: 'static_text', data: { content: CHEVRON } } } },
      }),
    ],
  });
}

export const storeLayoutTemplates: Record<string, LayoutTemplate> = {
  'Products grid': {
    category: 'Store',
    previewImage: '/ycode/layouts/previews/store-products-grid.webp',
    template: band(
      [
        heading('Our products'),
        layer('productGrid', 'w-[100%]', {
          settings: { tag: 'div', store: { productGrid: { ...PRODUCT_GRID_DEFAULTS, categories: [] } } },
        }),
      ],
      'Products grid',
    ),
  },

  'Featured products': {
    category: 'Store',
    previewImage: '/ycode/layouts/previews/store-featured-products.webp',
    template: band(
      [
        layer('div', 'flex flex-row items-center justify-between gap-[12px] w-[100%]', { customName: 'Heading row', children: [heading('Featured products'), viewAll()] }),
        layer('div', 'grid grid-cols-4 gap-[24px] w-[100%] max-lg:flex max-lg:flex-row max-lg:gap-[12px] max-lg:overflow-x-auto max-lg:w-[calc(100%+32px)] max-lg:ml-[-16px] max-lg:mr-[-16px] max-lg:pl-[16px] max-lg:pr-[16px]', {
          customName: 'Featured row',
          children: [productCard(), productCard(), productCard(), productCard()],
        }),
      ],
      'Featured products',
    ),
  },
};
