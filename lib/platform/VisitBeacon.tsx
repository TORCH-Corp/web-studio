'use client';

import { usePathname } from 'next/navigation';
import { useEffect } from 'react';
import { reportView, type VisitBrowser } from '@/lib/platform/visit-client';

/**
 * Counts a view of a published page (part 3, session W7): once the page is on
 * the visitor's screen it tells its own host, in the background
 * (lib/platform/visit-client.ts). It runs after the page has loaded, so it
 * delays nothing, and again when the visitor moves to another page without a
 * full load. With scripts off it never runs and the view is not counted.
 * Renders nothing.
 *
 * components/PageRenderer.tsx mounts it on a published page only: never in the
 * builder's canvas or preview, nor on an error page.
 */
export default function VisitBeacon({ pageId }: { pageId: string }) {
  // The path is read so the effect runs again when one page shows another address (a collection's items).
  const pathname = usePathname();
  useEffect(() => reportView(pageId, window as unknown as VisitBrowser), [pageId, pathname]);
  return null;
}
