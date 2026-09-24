'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Spinner } from './icons';
import { buttonClass } from './ui';

/**
 * Signing out is a POST, so it needs a button and a little JavaScript rather
 * than a link — see the comment in app/api/auth/logout/route.ts for why a GET
 * would be a liability.
 */
export function LogoutButton({ full = false }: { full?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function logout(): Promise<void> {
    if (busy) return;
    setBusy(true);

    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // The cookie may already be gone, and there is nothing useful to say
      // here — either way the next step is to leave the dashboard.
    }

    // `refresh()` first: every server component in the tree was rendered for a
    // signed-in user and must be thrown away before we navigate, or the
    // browser paints a cached dashboard on the way out.
    router.refresh();
    router.push('/');
  }

  return (
    <button
      type="button"
      onClick={logout}
      disabled={busy}
      className={buttonClass({ variant: 'secondary', size: 'sm', full })}
    >
      {busy && <Spinner className="h-3.5 w-3.5" />}
      {busy ? 'Signing out…' : 'Sign out'}
    </button>
  );
}
