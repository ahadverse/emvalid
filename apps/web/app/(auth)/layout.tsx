import type { ReactNode } from 'react';
import Link from 'next/link';
import { Logo } from '@/components/icons';

/**
 * The third shell — /login and /signup.
 *
 * One column, no nav, no footer links. Everything a header would offer on
 * these two pages is a way to leave without finishing, and the only navigation
 * that belongs here is the wordmark going home.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative isolate flex min-h-screen flex-col items-center justify-center px-4 py-12">
      <div
        aria-hidden
        className="bg-grid pointer-events-none absolute inset-x-0 top-0 -z-10 h-80 opacity-60"
      />

      <Link
        href="/"
        className="mb-8 flex items-center gap-2.5 transition-opacity hover:opacity-80"
      >
        <Logo className="h-7 w-7 text-accent" />
        <span className="text-base font-semibold tracking-[-0.01em]">Email Validator</span>
      </Link>

      <main id="main" className="w-full max-w-sm">
        {children}
      </main>

      <p className="mt-8 max-w-sm text-center text-xs leading-relaxed text-ink-subtle">
        Uploaded lists are deleted automatically once their retention window passes. We never send
        mail to an address you verify.
      </p>
    </div>
  );
}
