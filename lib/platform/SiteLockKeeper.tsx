'use client';

import { useEffect } from 'react';
import { startKeepingLock } from '@/lib/platform/site-lock-client';

/**
 * Keeps the open site's editor lock for as long as the builder is open (part 1,
 * session 6): takes it on the first load, refreshes it every minute, lets go on
 * close. Renders nothing; the banner is SiteLockBanner, inside the builder.
 */
export default function SiteLockKeeper() {
  useEffect(() => startKeepingLock(), []);
  return null;
}
