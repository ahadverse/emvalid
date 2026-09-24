'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { Alert } from '@/components/icons';
import { buttonClass, Card } from '@/components/ui';

/**
 * The root error boundary. It replaces whichever shell was rendering when the
 * throw happened, so — like app/not-found.tsx — it brings its own page frame
 * rather than assuming a header exists above it.
 *
 * The message deliberately says nothing about what broke: `error.digest` is
 * the handle for correlating this with the server log, and the log is where
 * the detail belongs. Printing a stack trace here would leak internals to
 * whoever tripped over the bug.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="grid min-h-screen place-items-center px-4 py-16">
      <Card className="w-full max-w-lg">
        <div className="px-6 py-12 text-center">
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-xl border border-bad/30 bg-bad-soft text-bad">
            <Alert className="h-5 w-5" />
          </span>

          <h1 className="mt-5 text-base font-semibold tracking-tight text-ink">
            Something went wrong
          </h1>
          <p className="mx-auto mt-2 max-w-sm text-[13px] leading-relaxed text-ink-muted">
            The page could not be rendered. Trying again is usually enough — nothing you uploaded
            is affected by this.
          </p>

          {error.digest !== undefined && (
            <p className="mt-4 inline-block rounded-md border border-line bg-surface-sunken px-2.5 py-1 font-mono text-xs text-ink-subtle">
              {error.digest}
            </p>
          )}

          <div className="mt-6 flex flex-wrap justify-center gap-2.5">
            <button type="button" onClick={reset} className={buttonClass()}>
              Try again
            </button>
            <Link href="/" className={buttonClass({ variant: 'secondary' })}>
              Go to verification
            </Link>
          </div>
        </div>
      </Card>
    </div>
  );
}
