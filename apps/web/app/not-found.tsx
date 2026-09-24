import Link from 'next/link';
import { Search } from '@/components/icons';
import { buttonClass, Card } from '@/components/ui';

/**
 * Rendered inside the bare root layout, which has no header, no footer and no
 * padding — an unmatched URL belongs to neither shell, so it brings its own
 * page frame rather than borrowing one that might be the wrong half of the
 * product.
 */
export default function NotFound() {
  return (
    <div className="grid min-h-screen place-items-center px-4 py-16">
      <Card className="w-full max-w-lg">
        <div className="px-6 py-12 text-center">
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-xl border border-line bg-surface-sunken text-ink-subtle">
            <Search className="h-5 w-5" />
          </span>

          <p className="mt-5 font-mono text-xs uppercase tracking-[0.1em] text-ink-subtle">404</p>
          <h1 className="mt-1.5 text-base font-semibold tracking-tight text-ink">Page not found</h1>
          <p className="mx-auto mt-2 max-w-sm text-[13px] leading-relaxed text-ink-muted">
            That address does not lead anywhere.
          </p>

          <div className="mt-6 flex flex-wrap justify-center gap-2.5">
            <Link href="/" className={buttonClass()}>
              Go to verification
            </Link>
            <Link href="/jobs" className={buttonClass({ variant: 'secondary' })}>
              View jobs
            </Link>
          </div>
        </div>
      </Card>
    </div>
  );
}
