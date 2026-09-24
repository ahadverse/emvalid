'use client';

import { useEffect, useState, type ComponentType, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Bolt,
  ChevronRight,
  Close,
  Key,
  Layers,
  Logo,
  Mail,
  Menu,
  Plus,
  Shield,
  type IconProps,
} from './icons';
import { LogoutButton } from './logout-button';
import { buttonClass } from './ui';

/**
 * The tool's shell — a rail on the left, a thin bar across the top, content
 * filling everything else.
 *
 * A client component because the rail and the bar share one piece of state:
 * whether the mobile drawer is open. `children` arrives already rendered on
 * the server, so putting the shell on the client costs nothing in the pages it
 * wraps.
 *
 * The rail is rendered twice — once fixed for wide screens, once inside the
 * drawer — from a single `RailBody`, so the two can never drift apart.
 *
 * `user` is passed down rather than read here: a client component cannot see
 * the session cookie, and the layout above has already resolved it.
 */

export interface ShellUser {
  email: string;
  name: string | null;
  role: 'user' | 'admin';
  credits: number;
}

interface NavItem {
  href: string;
  label: string;
  icon: ComponentType<IconProps>;
  /** Shown in the top bar when this section is current. */
  crumb: string;
}

const WORKSPACE: readonly NavItem[] = [
  { href: '/jobs', label: 'Jobs', icon: Layers, crumb: 'Jobs' },
  { href: '/keys', label: 'API keys', icon: Key, crumb: 'API keys' },
];

const ACCOUNT: readonly NavItem[] = [
  { href: '/account', label: 'Account and billing', icon: Bolt, crumb: 'Account' },
];

const ADMIN: readonly NavItem[] = [
  { href: '/admin', label: 'Overview', icon: Shield, crumb: 'Admin' },
  { href: '/admin/users', label: 'Users', icon: Layers, crumb: 'Users' },
];

/** Every section, flattened — the breadcrumb resolves against this. */
const ALL_ITEMS: readonly NavItem[] = [...WORKSPACE, ...ACCOUNT, ...ADMIN];

function isActive(href: string, pathname: string): boolean {
  // `/admin` must not light up for `/admin/users`, which has its own entry.
  if (href === '/admin') return pathname === '/admin';
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppShell({ user, children }: { user: ShellUser; children: ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

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
    <div className="lg:grid lg:grid-cols-[15.5rem_minmax(0,1fr)]">
      {/* ---------------------------------------------- Fixed rail */}
      <aside className="sticky top-0 hidden h-screen border-r border-line bg-surface lg:flex lg:flex-col">
        <RailBody user={user} pathname={pathname} />
      </aside>

      {/* ---------------------------------------------- Drawer */}
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setOpen(false)}
            className="absolute inset-0 h-full w-full cursor-default bg-ink/25 backdrop-blur-sm"
          />
          <div
            id="app-drawer"
            className="absolute inset-y-0 left-0 flex w-[17rem] max-w-[85vw] animate-fade flex-col border-r border-line bg-surface shadow-pop"
          >
            <RailBody user={user} pathname={pathname} onClose={() => setOpen(false)} />
          </div>
        </div>
      )}

      {/* ---------------------------------------------- Content column */}
      <div className="flex min-h-screen flex-col">
        <header className="sticky top-0 z-40 flex h-14 items-center gap-3 border-b border-line bg-canvas/85 px-4 backdrop-blur-md sm:px-6">
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-expanded={open}
            aria-controls="app-drawer"
            aria-label="Open menu"
            className={buttonClass({
              variant: 'secondary',
              size: 'sm',
              className: 'px-2 lg:hidden',
            })}
          >
            <Menu className="h-4 w-4" />
          </button>

          <Breadcrumb pathname={pathname} />

          <div className="ml-auto flex items-center gap-2">
            {/*
              The balance lives in the top bar because it is the number that
              decides whether the primary action beside it will work at all.
            */}
            <Link
              href="/account"
              title="Verification credits remaining"
              className={[
                'hidden items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium tabular-nums transition-colors sm:inline-flex',
                user.credits > 0
                  ? 'border-line bg-surface text-ink-muted hover:text-ink'
                  : 'border-bad/35 bg-bad-soft text-bad',
              ].join(' ')}
            >
              <Bolt className="h-3.5 w-3.5" />
              {user.credits.toLocaleString('en-US')}
            </Link>

            <Link href="/" className={buttonClass({ variant: 'primary', size: 'sm' })}>
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">New verification</span>
              <span className="sm:hidden">New</span>
            </Link>
          </div>
        </header>

        <main id="main" className="flex-1 px-4 py-8 sm:px-6 sm:py-10">
          <div className="mx-auto w-full max-w-6xl">{children}</div>
        </main>
      </div>
    </div>
  );
}

function RailBody({
  user,
  pathname,
  onClose,
}: {
  user: ShellUser;
  pathname: string;
  onClose?: () => void;
}) {
  return (
    <>
      <div className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-line px-4">
        <Link href="/" className="flex items-center gap-2.5 transition-opacity hover:opacity-80">
          <Logo className="h-6 w-6 text-accent" />
          <span className="text-[15px] font-semibold tracking-[-0.01em]">Email Validator</span>
        </Link>

        {onClose !== undefined && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close menu"
            className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-ink-subtle transition-colors hover:bg-surface-sunken hover:text-ink"
          >
            <Close className="h-4 w-4" />
          </button>
        )}
      </div>

      <nav aria-label="Sections" className="flex-1 space-y-6 overflow-y-auto px-3 py-4">
        <RailGroup heading="Workspace" items={WORKSPACE} pathname={pathname} />
        <RailGroup heading="Account" items={ACCOUNT} pathname={pathname} />
        {user.role === 'admin' && (
          <RailGroup heading="Administration" items={ADMIN} pathname={pathname} />
        )}

        <div className="px-2.5 pt-2">
          <Link
            href="/"
            className="flex items-center gap-2.5 text-sm text-ink-muted transition-colors hover:text-ink"
          >
            <Mail className="h-4 w-4 shrink-0" />
            Verify a list
          </Link>
        </div>
      </nav>

      <div className="shrink-0 space-y-3 border-t border-line p-3">
        <Link
          href="/account"
          className="block rounded-lg border border-line bg-surface-sunken p-3 transition-colors hover:border-line-strong"
        >
          <p className="truncate text-[13px] font-medium text-ink">{user.name ?? user.email}</p>
          {user.name !== null && (
            <p className="truncate text-xs text-ink-subtle">{user.email}</p>
          )}
          <p className="mt-1.5 flex items-center gap-1.5 text-xs tabular-nums text-ink-muted">
            <Bolt className="h-3 w-3" />
            {user.credits.toLocaleString('en-US')} credits
            <ChevronRight className="ml-auto h-3 w-3 text-ink-subtle" />
          </p>
        </Link>

        <LogoutButton full />
      </div>
    </>
  );
}

function RailGroup({
  heading,
  items,
  pathname,
}: {
  heading: string;
  items: readonly NavItem[];
  pathname: string;
}) {
  return (
    <div>
      <h2 className="px-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-subtle">
        {heading}
      </h2>
      <ul className="mt-2 grid gap-0.5">
        {items.map((item) => {
          const active = isActive(item.href, pathname);
          const Icon = item.icon;

          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={[
                  'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors duration-150',
                  active
                    ? 'bg-accent-soft font-medium text-accent'
                    : 'text-ink-muted hover:bg-surface-sunken hover:text-ink',
                ].join(' ')}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * Where you are, derived from the URL.
 *
 * The trailing segment of a job URL is a uuid, which is unreadable at full
 * length and unique at eight characters — so it is truncated rather than
 * replaced with a generic word. The job's own filename is the `<h1>` on the
 * page below, which is where a human-readable name belongs.
 */
function Breadcrumb({ pathname }: { pathname: string }) {
  const segments = pathname.split('/').filter(Boolean);

  // Longest match first, so /admin/users resolves to its own entry rather
  // than to /admin plus a stray "users" crumb.
  const current =
    ALL_ITEMS.find((item) => item.href === `/${segments.slice(0, 2).join('/')}`) ??
    ALL_ITEMS.find((item) => item.href === `/${segments[0] ?? ''}`);

  if (current === undefined) return null;

  const consumed = current.href.split('/').filter(Boolean).length;
  const detail = segments[consumed];

  return (
    <nav aria-label="Breadcrumb" className="min-w-0">
      <ol className="flex min-w-0 items-center gap-1.5 text-[13px]">
        <li className="shrink-0">
          {detail === undefined ? (
            <span className="font-medium text-ink" aria-current="page">
              {current.crumb}
            </span>
          ) : (
            <Link href={current.href} className="text-ink-muted transition-colors hover:text-ink">
              {current.crumb}
            </Link>
          )}
        </li>

        {detail !== undefined && (
          <>
            <li aria-hidden className="shrink-0 text-ink-subtle">
              <ChevronRight className="h-3.5 w-3.5" />
            </li>
            <li
              className="min-w-0 truncate font-mono text-xs font-medium text-ink"
              aria-current="page"
            >
              {detail.slice(0, 8)}
            </li>
          </>
        )}
      </ol>
    </nav>
  );
}
