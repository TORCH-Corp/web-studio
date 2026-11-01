'use client';

import { Alert, AlertTitle } from '@/components/ui/alert';
import { isReadOnly, useSiteLock } from '@/lib/platform/site-lock-client';

/**
 * Shown above the builder when another user is editing the site (part 1,
 * session 6): ycode's own Alert, the warning variant. The canvas stays
 * browsable; saving and publishing are off.
 */
export default function SiteLockBanner() {
  const lock = useSiteLock();
  if (!isReadOnly(lock)) return null;
  const editor = lock.editor?.name ?? 'Another editor';
  return (
    <Alert variant="warning" className="rounded-none border-x-0 border-t-0">
      <AlertTitle>{editor} is editing this site. You can look around, but nothing you change is saved.</AlertTitle>
    </Alert>
  );
}
