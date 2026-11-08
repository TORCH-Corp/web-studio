/**
 * The store pages' three colours (handoff/store/DESIGN_SYSTEM.md "Colour
 * variables a shop changes") as ycode colour variables.
 *
 * A ycode colour variable is addressed by a generated id (`--{id}`), so the
 * store elements find theirs by NAME: a site that has colour variables called
 * Primary, Primary soft and Dark (owner, W4 grill-me, 8 Nov 2026: the plain
 * names; the templates of Task B create them) re-skins every store element by
 * changing those three. A site without one gets the design system's default.
 *
 * The elements' stylesheet reads `--ws-store-primary`, `--ws-store-primary-soft`
 * and `--ws-store-dark`; this module says which ycode variable each one is.
 *
 * Kept free of Next and React imports so it runs under `node --test`.
 */

export const STORE_COLOUR_NAMES = {
  '--ws-store-primary': 'primary',
  '--ws-store-primary-soft': 'primary soft',
  '--ws-store-dark': 'dark',
} as const;

/** The design system's values, used when the site has no variable of that name. */
export const STORE_COLOUR_DEFAULTS = {
  '--ws-store-primary': '#0F766E',
  '--ws-store-primary-soft': '#E7F3F1',
  '--ws-store-dark': '#17201E',
} as const;

export type StoreColourProperty = keyof typeof STORE_COLOUR_NAMES;

const normalise = (name: string): string => name.trim().replace(/\s+/g, ' ').toLowerCase();

/**
 * The custom properties that point the store's colours at the site's variables:
 * `{ '--ws-store-primary': 'var(--<id>)' }` for each of the three the site has
 * (the first, in the order given, when a name is used twice). Missing ones are
 * left out, so the stylesheet's default applies.
 */
export function storeColourStyle(variables: ReadonlyArray<{ id: string; name: string }> | null | undefined): Partial<Record<StoreColourProperty, string>> {
  const style: Partial<Record<StoreColourProperty, string>> = {};
  for (const variable of variables ?? []) {
    const wanted = normalise(variable.name);
    for (const [property, name] of Object.entries(STORE_COLOUR_NAMES) as Array<[StoreColourProperty, string]>) {
      if (name === wanted && style[property] === undefined) style[property] = `var(--${variable.id})`;
    }
  }
  return style;
}
