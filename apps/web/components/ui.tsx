import type { ComponentType, ReactNode } from 'react';
import { Alert, Check, Info, type IconProps } from './icons';

/**
 * The shapes every page is built from.
 *
 * Still deliberately small — a component library here would be more surface
 * than the product needs — but every shape is now defined exactly once, because
 * repeating the same five class strings across nine pages is how a design
 * drifts.
 *
 * No 'use client': these are pure and render on whichever side imports them.
 * That is also why buttons are a class *function* rather than a component —
 * half of them are `<Link>`s, and a `<Button as={Link}>` escape hatch is more
 * machinery than `className={buttonClass()}` on the link itself.
 */

/* ------------------------------------------------------------------ *
 * Buttons and inputs
 * ------------------------------------------------------------------ */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md' | 'lg';

const BUTTON_BASE =
  'inline-flex shrink-0 items-center justify-center gap-2 rounded-lg font-medium whitespace-nowrap ' +
  'transition-[background-color,border-color,color,box-shadow,transform] duration-150 ' +
  'active:translate-y-px disabled:pointer-events-none disabled:opacity-50';

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  // The inset highlight is what stops a flat filled rectangle from looking
  // like a coloured div: it gives the top edge a light source.
  primary:
    'bg-accent text-accent-ink shadow-card ring-1 ring-inset ring-white/15 hover:bg-accent-hover',
  secondary: 'border border-line-strong bg-surface text-ink shadow-card hover:bg-surface-sunken',
  ghost: 'text-ink-muted hover:bg-surface-sunken hover:text-ink',
  danger: 'border border-bad/35 bg-bad-soft text-bad hover:border-bad/60',
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-[13px]',
  md: 'h-9.5 px-4 text-sm',
  lg: 'h-11 px-5 text-[15px]',
};

export function buttonClass({
  variant = 'primary',
  size = 'md',
  full = false,
  className = '',
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  full?: boolean;
  className?: string;
} = {}): string {
  return [
    BUTTON_BASE,
    BUTTON_VARIANTS[variant],
    BUTTON_SIZES[size],
    full ? 'w-full' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');
}

export const BUTTON_PRIMARY = buttonClass();
export const BUTTON_SECONDARY = buttonClass({ variant: 'secondary' });

export const INPUT =
  'h-9.5 w-full rounded-lg border border-line-strong bg-surface px-3.5 text-sm text-ink ' +
  'shadow-card transition-[border-color,box-shadow] duration-150 placeholder:text-ink-subtle ' +
  'hover:border-ink-subtle/60 focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/12';

/* ------------------------------------------------------------------ *
 * Containers
 * ------------------------------------------------------------------ */

export function Card({
  children,
  className = '',
  interactive = false,
}: {
  children: ReactNode;
  className?: string;
  /** Adds a hover lift. Only for cards that are themselves a link or button. */
  interactive?: boolean;
}) {
  return (
    <section
      className={[
        'rounded-xl border border-line bg-surface shadow-card',
        interactive
          ? 'transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:border-line-strong hover:shadow-raised'
          : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {children}
    </section>
  );
}

export function CardHeader({
  title,
  description,
  action,
  icon: Icon,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: ComponentType<IconProps>;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
      <div className="flex min-w-0 gap-3">
        {Icon !== undefined && (
          <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-line bg-surface-sunken text-ink-muted">
            <Icon className="h-4 w-4" />
          </span>
        )}
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold tracking-tight text-ink">{title}</h2>
          {description !== undefined && (
            <p className="mt-1 text-[13px] leading-relaxed text-ink-muted">{description}</p>
          )}
        </div>
      </div>
      {action}
    </div>
  );
}

/**
 * The page's opening statement. `eyebrow` carries the section the page belongs
 * to, so the `<h1>` can be the thing itself rather than "Jobs — Email
 * Validator" repeated in three sizes.
 */
export function PageHeader({
  title,
  description,
  action,
  eyebrow,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  eyebrow?: ReactNode;
}) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
      <div className="max-w-2xl">
        {eyebrow !== undefined && <div className="mb-3">{eyebrow}</div>}
        <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.02em] text-ink sm:text-[32px]">
          {title}
        </h1>
        {description !== undefined && (
          <p className="mt-3 text-[15px] leading-relaxed text-ink-muted">{description}</p>
        )}
      </div>
      {action}
    </div>
  );
}

/** The small uppercase label above a group of cards. */
export function SectionLabel({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-4">
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-subtle">
        {children}
      </h2>
      {action}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Small pieces
 * ------------------------------------------------------------------ */

export function Chip({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${className}`}
    >
      {children}
    </span>
  );
}

/**
 * The pill above a page title. Quiet by default because it is context, not
 * news — the one thing it must not do is compete with the `<h1>` under it.
 */
export function Eyebrow({
  children,
  icon: Icon,
  tone = 'neutral',
}: {
  children: ReactNode;
  icon?: ComponentType<IconProps>;
  tone?: 'neutral' | 'accent';
}) {
  return (
    <span
      className={[
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.07em]',
        tone === 'accent'
          ? 'border-accent-line bg-accent-soft text-accent'
          : 'border-line bg-surface text-ink-muted shadow-card',
      ].join(' ')}
    >
      {Icon !== undefined && <Icon className="h-3.5 w-3.5" />}
      {children}
    </span>
  );
}

export function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-medium uppercase tracking-wider text-ink-subtle">{label}</dt>
      <dd className="mt-1 break-words text-sm text-ink">{value}</dd>
    </div>
  );
}

export function Stat({
  label,
  value,
  hint,
  accent = 'text-ink',
  icon: Icon,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  accent?: string;
  icon?: ComponentType<IconProps>;
}) {
  return (
    <div className="group relative overflow-hidden rounded-xl border border-line bg-surface px-4 py-3.5 shadow-card transition-colors duration-200 hover:border-line-strong">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[11px] font-medium uppercase tracking-wider text-ink-subtle">
          {label}
        </div>
        {Icon !== undefined && <Icon className={`h-4 w-4 shrink-0 opacity-70 ${accent}`} />}
      </div>
      <div
        className={`mt-2 text-[26px] font-semibold leading-none tabular-nums tracking-[-0.02em] ${accent}`}
      >
        {value}
      </div>
      {hint !== undefined && (
        <div className="mt-2 text-xs leading-relaxed text-ink-subtle">{hint}</div>
      )}
    </div>
  );
}

/**
 * A labelled proportion bar. Used for both status mix and per-reason counts,
 * so the same visual weight always means the same thing.
 */
export function Meter({
  label,
  count,
  total,
  barClass = 'bg-accent',
  note,
}: {
  label: string;
  count: number;
  total: number;
  barClass?: string;
  note?: string;
}) {
  const share = total > 0 ? (count / total) * 100 : 0;

  return (
    <div>
      <div className="flex items-baseline justify-between gap-4 text-sm">
        <span className="truncate text-ink">{label}</span>
        {/*
          Two fixed-width right-aligned columns rather than one run of text.
          Inline, the percent sign drifts left every time a count gains a
          digit, and a column of percentages that does not line up is the one
          thing a reader is trying to compare down the list.
        */}
        <span className="flex shrink-0 items-baseline gap-3 tabular-nums">
          <span className="min-w-[3rem] text-right font-medium text-ink-muted">
            {count.toLocaleString('en-US')}
          </span>
          <span className="w-14 text-right text-ink-subtle">{share.toFixed(1)}%</span>
        </span>
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-line">
        <div
          className={`h-full rounded-full transition-[width] duration-500 ${barClass}`}
          style={{ width: `${share}%` }}
        />
      </div>
      {note !== undefined && <p className="mt-1.5 text-xs text-ink-subtle">{note}</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Messages
 * ------------------------------------------------------------------ */

const NOTICE_TONES = {
  neutral: {
    box: 'border-line bg-surface-sunken',
    mark: 'text-ink-subtle',
    icon: Info,
  },
  accent: {
    box: 'border-accent-line bg-accent-soft',
    mark: 'text-accent',
    icon: Info,
  },
  good: {
    box: 'border-good/30 bg-good-soft',
    mark: 'text-good',
    icon: Check,
  },
  warn: {
    box: 'border-warn/35 bg-warn-soft',
    mark: 'text-warn',
    icon: Alert,
  },
  bad: {
    box: 'border-bad/35 bg-bad-soft',
    mark: 'text-bad',
    icon: Alert,
  },
} as const;

export function Notice({
  tone = 'neutral',
  title,
  children,
}: {
  tone?: keyof typeof NOTICE_TONES;
  title?: string;
  children: ReactNode;
}) {
  const style = NOTICE_TONES[tone];
  const Icon = style.icon;

  return (
    <div className={`flex gap-3 rounded-lg border px-4 py-3 ${style.box}`}>
      {/* A shape as well as a colour — the amber box and the red box are the
          same grey to a deuteranope, and the difference between them is the
          difference between "look at this" and "this failed". */}
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${style.mark}`} />
      <div className="min-w-0 text-[13px] leading-relaxed text-ink-muted">
        {title !== undefined && <p className="mb-1 font-semibold text-ink">{title}</p>}
        {children}
      </div>
    </div>
  );
}

export function EmptyState({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon?: ComponentType<IconProps>;
  children?: ReactNode;
}) {
  return (
    <div className="px-5 py-16 text-center">
      {Icon !== undefined && (
        <span className="mx-auto mb-4 grid h-11 w-11 place-items-center rounded-xl border border-line bg-surface-sunken text-ink-subtle">
          <Icon className="h-5 w-5" />
        </span>
      )}
      <p className="text-sm font-medium text-ink">{title}</p>
      {children !== undefined && (
        <div className="mx-auto mt-2 max-w-md text-[13px] leading-relaxed text-ink-muted">
          {children}
        </div>
      )}
    </div>
  );
}

/**
 * The placeholder a `loading.tsx` renders. Sized by the caller so the skeleton
 * occupies the same space the real content will — a placeholder of the wrong
 * height is a layout shift with extra steps.
 */
export function Skeleton({ className = 'h-4 w-full' }: { className?: string }) {
  return <div aria-hidden className={`shimmer rounded-md ${className}`} />;
}
