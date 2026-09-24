'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ArrowRight, Close, Menu } from './icons';
import { buttonClass } from './ui';

/**
 * The public shell's navigation: two links and one call to action.
 *
 * Deliberately shorter than the sidebar's. A visitor on `/` has one decision
 * to make — try it, or read what it costs — and every extra destination in
 * this bar makes that decision slower.
 */

const LINKS = [
  { href: '/', label: 'Verify' },
  { href: '/pricing', label: 'Pricing' },
] as const;

export function MarketingNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // A menu that survives navigation covers the page the user just asked for.
  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return;

    function onKey(event: KeyboardEvent): void {
      if (event.key === 'Escape') setOpen(false);
    }

    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [open]);

  return (
    <>
      <nav aria-label="Primary" className="hidden items-center gap-1 text-sm sm:flex">
        {LINKS.map((link) => {
          const active = link.href === '/' ? pathname === '/' : pathname.startsWith(link.href);

          return (
            <Link
              key={link.href}
              href={link.href}
              aria-current={active ? 'page' : undefined}
              className={[
                'relative rounded-md px-3 py-1.5 transition-colors duration-150',
                active ? 'font-medium text-ink' : 'text-ink-muted hover:text-ink',
              ].join(' ')}
            >
              {link.label}
              {/*
                An underline anchored to the header's bottom rule rather than a
                filled pill. The header is a 1px line the whole way across;
                breaking that line under the current page says "you are here"
                using furniture that is already on screen.
              */}
              {active && (
                <span
                  aria-hidden
                  className="absolute inset-x-3 -bottom-[13px] h-0.5 rounded-full bg-accent"
                />
              )}
            </Link>
          );
        })}
      </nav>

      <div className="flex items-center gap-2">
        <Link
          href="/jobs"
          className={buttonClass({ variant: 'secondary', size: 'sm', className: 'hidden sm:flex' })}
        >
          Dashboard
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>

        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          aria-expanded={open}
          aria-controls="marketing-menu"
          aria-label={open ? 'Close menu' : 'Open menu'}
          className={buttonClass({ variant: 'secondary', size: 'sm', className: 'px-2 sm:hidden' })}
        >
          {open ? <Close className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
        </button>
      </div>

      {open && (
        <div className="fixed inset-0 z-50 sm:hidden">
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setOpen(false)}
            className="absolute inset-0 h-full w-full cursor-default bg-ink/20 backdrop-blur-sm"
          />

          <div
            id="marketing-menu"
            className="absolute inset-x-3 top-3 animate-rise rounded-xl border border-line bg-surface p-2 shadow-pop"
          >
            <nav aria-label="Primary" className="grid gap-0.5">
              {LINKS.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className="rounded-lg px-3 py-2.5 text-sm text-ink-muted transition-colors hover:bg-surface-sunken hover:text-ink"
                >
                  {link.label}
                </Link>
              ))}
            </nav>

            <div className="mt-2 border-t border-line pt-2">
              <Link href="/jobs" className={buttonClass({ full: true })}>
                Open dashboard
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
