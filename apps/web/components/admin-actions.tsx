'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Close, Plus, Spinner } from './icons';
import { buttonClass, Notice } from './ui';

/**
 * The buttons that change something in the admin area.
 *
 * All of them go through one `run` helper so every action shares the same
 * three behaviours: a busy state that blocks a second click, an error that is
 * shown rather than swallowed, and a `router.refresh()` on success — the pages
 * are server-rendered, so the refresh is what makes the table agree with what
 * just happened.
 */

function useAction() {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(key: string, url: string, body: unknown): Promise<void> {
    if (busy !== null) return;

    setBusy(key);
    setError(null);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const parsed: unknown = await response.json();

      if (!response.ok) {
        setError(
          (parsed as { error?: { message?: string } }).error?.message ??
            `Request failed (HTTP ${response.status}).`,
        );
        return;
      }

      router.refresh();
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(null);
    }
  }

  return { busy, error, run };
}

export function OrderActions({ orderId }: { orderId: string }) {
  const { busy, error, run } = useAction();
  const [reference, setReference] = useState('');

  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <input
          type="text"
          value={reference}
          onChange={(event) => setReference(event.target.value)}
          placeholder="bKash / bank ref"
          aria-label="Payment reference"
          maxLength={120}
          className="h-8 w-40 rounded-md border border-line-strong bg-surface px-2.5 text-[13px] text-ink placeholder:text-ink-subtle focus:border-accent focus:outline-none"
        />

        <button
          type="button"
          onClick={() =>
            run('paid', `/api/admin/orders/${orderId}`, { action: 'mark_paid', reference })
          }
          disabled={busy !== null}
          className={buttonClass({ size: 'sm' })}
        >
          {busy === 'paid' ? <Spinner className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}
          Mark paid
        </button>

        <button
          type="button"
          onClick={() => {
            if (!window.confirm('Cancel this order? No credits will be granted.')) return;
            void run('cancel', `/api/admin/orders/${orderId}`, { action: 'cancel' });
          }}
          disabled={busy !== null}
          className={buttonClass({ variant: 'danger', size: 'sm' })}
        >
          <Close className="h-3.5 w-3.5" />
          Cancel
        </button>
      </div>

      {error !== null && (
        <p className="mt-2 text-right text-xs text-bad">{error}</p>
      )}
    </div>
  );
}

export function UserActions({
  userId,
  role,
  status,
}: {
  userId: string;
  role: 'user' | 'admin';
  status: 'active' | 'suspended';
}) {
  const { busy, error, run } = useAction();
  const url = `/api/admin/users/${userId}`;

  function grant(): void {
    const raw = window.prompt('How many credits should be added to this account?', '1000');
    if (raw === null) return;

    const amount = Number(raw);
    if (!Number.isInteger(amount) || amount <= 0) {
      window.alert('Enter a whole number greater than zero.');
      return;
    }

    const note = window.prompt('Why? (recorded on the ledger entry)', '') ?? '';
    void run('grant', url, { action: 'grant_credits', amount, note });
  }

  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center justify-end gap-1.5">
        <button
          type="button"
          onClick={grant}
          disabled={busy !== null}
          className={buttonClass({ variant: 'secondary', size: 'sm' })}
        >
          {busy === 'grant' ? <Spinner className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
          Credits
        </button>

        <button
          type="button"
          onClick={() =>
            run('role', url, { action: 'set_role', role: role === 'admin' ? 'user' : 'admin' })
          }
          disabled={busy !== null}
          className={buttonClass({ variant: 'secondary', size: 'sm' })}
        >
          {busy === 'role' && <Spinner className="h-3.5 w-3.5" />}
          {role === 'admin' ? 'Demote' : 'Make admin'}
        </button>

        <button
          type="button"
          onClick={() => {
            if (
              status === 'active' &&
              !window.confirm('Suspend this account? Their sessions end immediately.')
            ) {
              return;
            }
            void run('status', url, { action: status === 'active' ? 'suspend' : 'activate' });
          }}
          disabled={busy !== null}
          className={buttonClass({
            variant: status === 'active' ? 'danger' : 'secondary',
            size: 'sm',
          })}
        >
          {busy === 'status' && <Spinner className="h-3.5 w-3.5" />}
          {status === 'active' ? 'Suspend' : 'Reinstate'}
        </button>
      </div>

      {error !== null && <p className="mt-2 text-right text-xs text-bad">{error}</p>}
    </div>
  );
}

/** Shown at the top of the admin area when an action needs explaining. */
export function AdminNotice({ children }: { children: React.ReactNode }) {
  return <Notice tone="accent">{children}</Notice>;
}
