'use client';

import { useState, type FormEvent } from 'react';
import type { InspectedEmail } from '@ev/core';
import { Mail, Search, Spinner } from './icons';
import { buttonClass, Card, INPUT, Notice } from './ui';
import { ResultView } from './result-view';

/**
 * Feature 19's front end — check one address and show the whole answer.
 *
 * Deliberately unbatched and unabbreviated: this is where someone decides
 * whether the tool is worth paying for, and a single fully-explained result
 * makes that case better than a list of green ticks.
 */

/**
 * One address per interesting verdict, so the demo can be driven without the
 * visitor having to think of an address that proves anything. Every one of
 * these is a domain that exists, because an example that came back
 * "domain not found" would be demonstrating a typo rather than the tool.
 */
const EXAMPLES = [
  { address: 'support@gmail.com', shows: 'Role address' },
  { address: 'hello@gmial.com', shows: 'Suspected typo' },
  { address: 'someone@mailinator.com', shows: 'Disposable' },
] as const;

export function SingleCheck() {
  const [email, setEmail] = useState('');
  const [inspected, setInspected] = useState<InspectedEmail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function check(address: string): Promise<void> {
    if (address.length === 0 || busy) return;

    setBusy(true);
    setError(null);
    // The previous result is cleared immediately — leaving it on screen while
    // a new address is checked invites reading the old verdict as the new one.
    setInspected(null);

    try {
      const response = await fetch('/api/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: address }),
      });

      const body: unknown = await response.json();

      if (!response.ok) {
        const message = (body as { error?: { message?: string } }).error?.message;
        setError(message ?? `Check failed (HTTP ${response.status}).`);
        return;
      }

      setInspected(body as InspectedEmail);
    } catch {
      setError('Could not reach the verification service.');
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void check(email.trim());
  }

  function runExample(address: string): void {
    setEmail(address);
    void check(address);
  }

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-line px-5 py-4">
        <div className="flex min-w-0 gap-3">
          <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-line bg-surface-sunken text-ink-muted">
            <Search className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold tracking-tight text-ink">Check one address</h2>
            <p className="mt-1 text-[13px] leading-relaxed text-ink-muted">
              Nine checks — syntax, normalization, policy and DNS — each reported separately, with
              the reasoning behind the verdict.
            </p>
          </div>
        </div>
      </div>

      <div className="px-5 py-4">
        <form onSubmit={onSubmit} className="flex flex-col gap-2.5 sm:flex-row">
          <div className="relative sm:flex-1">
            <Mail
              className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle"
              aria-hidden
            />
            <input
              type="text"
              inputMode="email"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="name@example.com"
              aria-label="Email address to check"
              className={`${INPUT} pl-10 font-mono`}
            />
          </div>
          <button
            type="submit"
            disabled={busy || email.trim().length === 0}
            className={buttonClass()}
          >
            {busy && <Spinner className="h-4 w-4" />}
            {busy ? 'Checking…' : 'Check'}
          </button>
        </form>

        <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-2">
          <span className="text-[13px] text-ink-subtle">Try:</span>
          {EXAMPLES.map((example) => (
            <button
              key={example.address}
              type="button"
              onClick={() => runExample(example.address)}
              disabled={busy}
              title={`Shows: ${example.shows}`}
              className="rounded-full border border-line bg-surface-sunken px-2.5 py-1 font-mono text-[11px] text-ink-muted transition-colors hover:border-line-strong hover:text-ink disabled:opacity-50"
            >
              {example.address}
            </button>
          ))}
        </div>
      </div>

      {error !== null && (
        <div className="border-t border-line px-5 py-4">
          <Notice tone="bad">{error}</Notice>
        </div>
      )}

      {inspected !== null && (
        <div className="animate-fade border-t border-line">
          <ResultView result={inspected.result} checks={inspected.checks} />
        </div>
      )}
    </Card>
  );
}
