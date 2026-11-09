import React from 'react';
import clsx from 'clsx';
import { STORE_FONT_CSS_URL } from '@/lib/platform/store-elements/fonts';
import { STORE_CSS } from '@/lib/platform/store-elements/styles';
import { storeDirOf, type StoreLang } from '@/lib/platform/store-elements/strings';

type ShellProps = Omit<React.HTMLAttributes<HTMLDivElement>, 'dir' | 'lang'> & {
  /** The element, for `data-ws-store`: one of STORE_ELEMENT_NAMES. */
  element: string;
  lang: StoreLang;
  /** The site's own colours for the three variables a shop changes (colours.ts). */
  colours?: Record<string, string | undefined>;
  /** The element has nothing to show: the wrapper takes no room, whatever the layer's classes say (a featured row then shortens). */
  collapsed?: boolean;
  ref?: React.Ref<HTMLDivElement>;
};

/**
 * The wrapper every store element has: the layer's own classes and style (the
 * builder styles the wrapper), the page's language and direction, the store
 * colours, and the element's stylesheet and font. The wrapper takes the layer's
 * attributes as given, so on the canvas it is selected, dragged and outlined
 * like any other layer.
 */
export function StoreShell({ element, lang, colours, collapsed = false, className, style, children, ref, ...rest }: ShellProps) {
  return (
    <div
      {...rest}
      ref={ref}
      data-ws-store={element}
      className={clsx('ws-store', className)}
      style={{ ...style, ...colours, ...(collapsed ? { display: 'none' } : null) } as React.CSSProperties}
      dir={storeDirOf(lang)}
      lang={lang}
    >
      <link rel="stylesheet" href={STORE_FONT_CSS_URL} />
      <style dangerouslySetInnerHTML={{ __html: STORE_CSS }} />
      {children}
    </div>
  );
}
