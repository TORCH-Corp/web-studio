'use client';

import Link from 'next/link';

/** Invitations are issued in Business OS Organization Setup; this page only points people back. */
export default function AcceptInvitePage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-neutral-950 text-neutral-200">
      <div className="max-w-md text-center space-y-3 p-8">
        <h1 className="text-lg font-medium">Web Studio access is managed in Business OS</h1>
        <p className="text-sm text-neutral-400">
          Ask your organization admin to give you the Web Studio permission in Organization Setup, then open Web Studio from Business OS.
        </p>
        <Link href="/ycode" className="text-sm underline">Back to Web Studio</Link>
      </div>
    </div>
  );
}
