import type { ReactNode } from 'react';
import { AppShell } from '@/components/app-shell';
import { requireUser } from '@/lib/session';

/**
 * The tool shell — everything behind a login.
 *
 * The `requireUser` here is the belt to the routes' braces: it means a new
 * page added under app/(app) is protected the moment the file exists, rather
 * than the moment somebody remembers to add a guard to it. The API routes each
 * call `guardUi` separately, because a layout does not run for a fetch.
 *
 * Everything about this shell is the opposite of app/(marketing): a persistent
 * rail instead of a top nav, a breadcrumb instead of a hero, and no footer at
 * all. A dashboard someone keeps open all day should not end in a marketing
 * paragraph they have already read.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();

  return (
    <AppShell
      user={{
        email: user.email,
        name: user.name,
        role: user.role,
        credits: user.credits,
      }}
    >
      {children}
    </AppShell>
  );
}
