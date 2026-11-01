'use client';

import { useEffect, useState } from 'react';
import BuilderLoading from '@/components/BuilderLoading';
import { sessionState, subscribeSession } from '@/lib/platform/browser-session';

/**
 * Shown over the builder while the Business OS session is being renewed after
 * it died under the user (part 1, session 2). The page and its state stay
 * underneath: this is a wait, not a sign-out. ycode's own loading screen, with
 * the words every child app uses (Document Center's reconnecting notice).
 */
export default function SessionNotice() {
  const [lost, setLost] = useState(false);

  useEffect(() => {
    setLost(sessionState().lost);
    return subscribeSession((state) => setLost(state.lost));
  }, []);

  if (!lost) return null;
  return (
    <div
      className="fixed inset-0 z-[200]" role="status"
      aria-live="polite"
    >
      <BuilderLoading title="Reconnecting to Business OS…" message="Your session is being renewed. The builder continues by itself." />
    </div>
  );
}
