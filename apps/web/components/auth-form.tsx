'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { emailProblem, passwordProblem, PASSWORD_MIN_LENGTH } from '@/lib/account-input';
import { Mail, Spinner } from './icons';
import { buttonClass, INPUT, Notice } from './ui';

/**
 * One component for both /login and /signup.
 *
 * The two forms differ by three things — a name field, a heading and which
 * endpoint they POST to — and none of that is worth two files that drift.
 *
 * Validation runs here *and* in the route. This copy exists so a typo is
 * caught without a round trip; the route's copy is the one that decides,
 * because anything the browser checks can be skipped by not using a browser.
 */

type Mode = 'login' | 'signup';

const COPY = {
  login: {
    submit: 'Sign in',
    busy: 'Signing in…',
    endpoint: '/api/auth/login',
    switchPrompt: 'No account yet?',
    switchLabel: 'Create one',
    switchHref: '/signup',
  },
  signup: {
    submit: 'Create account',
    busy: 'Creating account…',
    endpoint: '/api/auth/signup',
    switchPrompt: 'Already have an account?',
    switchLabel: 'Sign in',
    switchHref: '/login',
  },
} as const;

export function AuthForm({ mode, next }: { mode: Mode; next: string }) {
  const router = useRouter();
  const copy = COPY[mode];

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy) return;

    const localProblem =
      emailProblem(email) ?? (mode === 'signup' ? passwordProblem(password) : null);

    if (localProblem !== null) {
      setError(localProblem);
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const response = await fetch(copy.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          mode === 'signup' ? { email, password, name } : { email, password },
        ),
      });

      const body: unknown = await response.json();

      if (!response.ok) {
        setError(
          (body as { error?: { message?: string } }).error?.message ??
            `Could not sign in (HTTP ${response.status}).`,
        );
        return;
      }

      /*
       * `refresh()` before `push()`, and both are needed. The session cookie
       * arrived on this response, but every server component already rendered
       * for this navigation was rendered without it — without the refresh the
       * dashboard would paint from a cache that still believes nobody is
       * signed in.
       */
      router.refresh();
      router.push(next);
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {error !== null && <Notice tone="bad">{error}</Notice>}

      {mode === 'signup' && (
        <div>
          <label htmlFor="name" className="mb-1.5 block text-[13px] font-medium text-ink">
            Name <span className="font-normal text-ink-subtle">(optional)</span>
          </label>
          <input
            id="name"
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoComplete="name"
            maxLength={80}
            placeholder="Ahad Hossain"
            className={INPUT}
          />
        </div>
      )}

      <div>
        <label htmlFor="email" className="mb-1.5 block text-[13px] font-medium text-ink">
          Email
        </label>
        <div className="relative">
          <Mail
            aria-hidden
            className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle"
          />
          <input
            id="email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
            autoCapitalize="off"
            spellCheck={false}
            required
            placeholder="you@company.com"
            className={`${INPUT} pl-10`}
          />
        </div>
      </div>

      <div>
        <label htmlFor="password" className="mb-1.5 block text-[13px] font-medium text-ink">
          Password
        </label>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          // Tells a password manager to offer a new one rather than autofill
          // the old one — getting this wrong is why signup forms silently
          // reuse a password the user did not choose.
          autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
          required
          minLength={mode === 'signup' ? PASSWORD_MIN_LENGTH : undefined}
          className={INPUT}
        />
        {mode === 'signup' && (
          <p className="mt-1.5 text-xs text-ink-subtle">
            At least {PASSWORD_MIN_LENGTH} characters. A phrase you will remember beats a short
            one with symbols in it.
          </p>
        )}
      </div>

      <button type="submit" disabled={busy} className={buttonClass({ full: true, size: 'lg' })}>
        {busy && <Spinner className="h-4 w-4" />}
        {busy ? copy.busy : copy.submit}
      </button>

      <p className="text-center text-[13px] text-ink-muted">
        {copy.switchPrompt}{' '}
        <Link
          href={next === '/jobs' ? copy.switchHref : `${copy.switchHref}?next=${encodeURIComponent(next)}`}
          className="font-medium text-accent hover:underline"
        >
          {copy.switchLabel}
        </Link>
      </p>
    </form>
  );
}
