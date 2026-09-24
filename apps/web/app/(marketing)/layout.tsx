import type { ReactNode } from 'react';
import Link from 'next/link';
import { Logo } from '@/components/icons';
import { MarketingNav } from '@/components/marketing-nav';

/**
 * The public shell — `/` and `/pricing`.
 *
 * Centred to 72rem, generous vertical rhythm, and a footer that carries the
 * one paragraph this product is unusual for printing: that we do not claim a
 * mailbox exists when we have not established it. The dense tool shell in
 * app/(app) has none of this, which is the point of splitting them.
 */

const FOOTER_LINKS: readonly {
  heading: string;
  items: readonly { href: string; label: string }[];
}[] = [
  {
    heading: 'Product',
    items: [
      { href: '/', label: 'Verify a list' },
      { href: '/pricing', label: 'Pricing' },
      { href: '/jobs', label: 'Dashboard' },
    ],
  },
  {
    heading: 'Developers',
    items: [
      { href: '/keys', label: 'API keys' },
      { href: '/keys#reference', label: 'API reference' },
    ],
  },
];

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-40 border-b border-line bg-canvas/80 backdrop-blur-md">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link
            href="/"
            className="flex shrink-0 items-center gap-2.5 transition-opacity hover:opacity-80"
          >
            <Logo className="h-6 w-6 text-accent" />
            <span className="text-[15px] font-semibold tracking-[-0.01em]">Email Validator</span>
          </Link>

          <MarketingNav />
        </div>
      </header>

      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-12 sm:px-6 sm:py-16">
        {children}
      </main>

      <footer className="mt-8 border-t border-line bg-surface-sunken">
        <div className="mx-auto w-full max-w-6xl px-4 py-12 sm:px-6">
          <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            <div className="lg:col-span-2">
              <div className="flex items-center gap-2.5">
                <Logo className="h-5 w-5 text-accent" />
                <span className="text-sm font-semibold tracking-[-0.01em]">Email Validator</span>
              </div>
              <p className="mt-3 max-w-sm text-[13px] leading-relaxed text-ink-muted">
                Syntax, domain and policy verification for email lists. Every row comes back with a
                status, a confidence score and the reason behind it.
              </p>
            </div>

            {FOOTER_LINKS.map((group) => (
              <div key={group.heading}>
                <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-subtle">
                  {group.heading}
                </h2>
                <ul className="mt-3 space-y-2">
                  {group.items.map((item) => (
                    <li key={item.href + item.label}>
                      <Link
                        href={item.href}
                        className="text-[13px] text-ink-muted transition-colors hover:text-ink"
                      >
                        {item.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          {/*
            The one paragraph on the site that exists to talk a customer out of
            a belief rather than into one. It stays on the pricing page too, on
            purpose.
          */}
          <div className="mt-10 flex flex-col gap-4 border-t border-line pt-6 sm:flex-row sm:items-start sm:justify-between">
            <p className="max-w-3xl text-[13px] leading-relaxed text-ink-subtle">
              We check syntax, domain and policy, and we never claim a mailbox exists when we have
              not established it — addresses that pass every check are reported as{' '}
              <span className="text-ink-muted">unknown</span>, not as valid.
            </p>
            <p className="shrink-0 text-[13px] text-ink-subtle">
              © {new Date().getFullYear()} Email Validator
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
