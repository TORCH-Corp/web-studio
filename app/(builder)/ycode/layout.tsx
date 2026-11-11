import { headers } from 'next/headers';
import { PrimaryDomainProvider } from '@/hooks/use-primary-domain';
import { getRequestOrigin } from '@/lib/url-utils';
import YCodeLayoutClient from './YCodeLayoutClient';

/**
 * Ycode Editor Layout (Server Component)
 * 
 * Forces dynamic rendering for all /ycode/* routes.
 * This is required because:
 * 1. Editor routes require authentication (user-specific)
 * 2. Client components use useSearchParams which needs dynamic context
 *
 * Resolves the site's primary domain and forwards it via context so client
 * components can render the canonical URL on first paint.
 */

// Force all /ycode routes to be dynamic - no static prerendering
// This prevents useSearchParams errors during build
export const dynamic = 'force-dynamic';

export default async function YCodeLayout({ children }: { children: React.ReactNode }) {
  const requestOrigin = getRequestOrigin(await headers());
  const primaryDomain = requestOrigin ? new URL(requestOrigin).hostname : null;

  return (
    <PrimaryDomainProvider value={primaryDomain}>
      <YCodeLayoutClient>{children}</YCodeLayoutClient>
    </PrimaryDomainProvider>
  );
}
