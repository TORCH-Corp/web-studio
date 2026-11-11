'use client';

import { useAuthStore } from '@/stores/useAuthStore';
import type { Flag, WebStudioLeaf } from './session';

/**
 * True when the signed-in user holds `flag` on `leaf`, from the flags the Business OS session carries
 * (`user.app_metadata.permissions`, set in `lib/supabase-auth.ts`). Part 3, session W2: the builder shows a
 * screen's way in only to a user the API will let through (rbac-bos: do not show a door that will slam). The server
 * refuses the call either way; this removes the dead end, it is not the protection.
 */
export function useHasFlag(leaf: WebStudioLeaf, flag: Flag): boolean {
  return useAuthStore((state) => {
    const permissions = state.user?.app_metadata?.permissions as Record<string, string[] | undefined> | undefined;
    return permissions?.[leaf]?.includes(flag) === true;
  });
}
