'use client';

import { useState, type FormEvent } from 'react';
import type { ApiKeySummary, CreatedApiKey } from '@/lib/dto';
import { formatDateTime } from '@/lib/format';
import { CopyButton } from './code-tabs';
import { Key, Plus, Spinner, Trash } from './icons';
import { buttonClass, Card, CardHeader, Chip, EmptyState, INPUT, Notice } from './ui';

/**
 * Feature 20's UI.
 *
 * The one rule this component exists to enforce: the raw key is rendered once,
 * from the creation response, and is never stored in state that survives a
 * reload or fetched again. Dismissing the panel destroys the only copy we
 * have, and the warning says so before the user clicks it.
 */
export function KeysManager({ initialKeys }: { initialKeys: ApiKeySummary[] }) {
  const [keys, setKeys] = useState<ApiKeySummary[]>(initialKeys);
  const [name, setName] = useState('');
  const [created, setCreated] = useState<CreatedApiKey | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const live = keys.filter((key) => key.revokedAt === null).length;

  async function create(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy) return;

    setBusy(true);
    setError(null);

    try {
      const response = await fetch('/api/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      });
      const body: unknown = await response.json();

      if (!response.ok) {
        setError(
          (body as { error?: { message?: string } }).error?.message ?? 'Could not create the key.',
        );
        return;
      }

      const key = body as CreatedApiKey;
      setCreated(key);
      setName('');
      // The summary sent to the list is built without `raw`, so the secret
      // cannot leak into a re-render of the table.
      const { raw: _raw, ...summary } = key;
      setKeys((current) => [summary, ...current]);
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }

  async function revoke(key: ApiKeySummary): Promise<void> {
    if (busy) return;
    if (
      !window.confirm(
        `Revoke "${key.name}"? Any integration using it will stop working immediately.`,
      )
    ) {
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const response = await fetch(`/api/keys/${key.id}`, { method: 'DELETE' });
      if (!response.ok) {
        setError('Could not revoke the key.');
        return;
      }
      const revokedAt = new Date().toISOString();
      setKeys((current) =>
        current.map((entry) => (entry.id === key.id ? { ...entry, revokedAt } : entry)),
      );
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      {created !== null && (
        <Card className="animate-rise border-warn/40 shadow-raised">
          <CardHeader
            title="Copy this key now"
            description="This is the only time it will ever be shown."
          />
          <div className="space-y-4 px-5 py-5">
            <div className="flex flex-wrap items-center gap-2">
              <code className="min-w-0 flex-1 break-all rounded-lg border border-line bg-surface-sunken px-3.5 py-2.5 font-mono text-[13px] text-ink">
                {created.raw}
              </code>
              <CopyButton
                value={created.raw}
                className="border border-line-strong bg-surface px-2.5 py-1.5 hover:bg-surface-sunken"
              />
            </div>

            <Notice tone="warn" title="We cannot show this key again">
              Only a SHA-256 hash of it is stored, so nobody — including us — can read it back. If
              you lose it, revoke the key and create another. Store it in your secret manager, not
              in source control.
            </Notice>

            <button
              type="button"
              onClick={() => setCreated(null)}
              className={buttonClass({ variant: 'secondary', size: 'sm' })}
            >
              I have stored it
            </button>
          </div>
        </Card>
      )}

      <Card>
        <CardHeader
          title="Create a key"
          description="Name it after the thing that will use it, so a revocation later is an easy decision."
          icon={Key}
        />
        <form onSubmit={create} className="flex flex-col gap-2.5 px-5 py-4 sm:flex-row">
          <input
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Production backend"
            aria-label="Key name"
            maxLength={60}
            className={`${INPUT} sm:flex-1`}
          />
          <button type="submit" disabled={busy} className={buttonClass()}>
            {busy ? <Spinner className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
            Create key
          </button>
        </form>
        {error !== null && (
          <div className="border-t border-line px-5 py-3.5">
            <Notice tone="bad">{error}</Notice>
          </div>
        )}
      </Card>

      <Card>
        <CardHeader
          title="Keys"
          action={
            keys.length > 0 ? (
              <span className="shrink-0 text-[13px] tabular-nums text-ink-subtle">
                {live} active
              </span>
            ) : undefined
          }
        />
        {keys.length === 0 ? (
          <EmptyState title="No API keys yet" icon={Key}>
            A key authenticates requests to /api/v1. Create one above to use the API.
          </EmptyState>
        ) : (
          <div className="scroll-x">
            <table className="w-full min-w-2xl text-sm">
              <thead>
                <tr className="border-b border-line bg-surface-sunken text-left text-[11px] uppercase tracking-wider text-ink-subtle">
                  <th className="px-5 py-2.5 font-semibold">Name</th>
                  <th className="px-5 py-2.5 font-semibold">Key</th>
                  <th className="px-5 py-2.5 font-semibold">Created</th>
                  <th className="px-5 py-2.5 font-semibold">Last used</th>
                  <th className="px-5 py-2.5 text-right font-semibold" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {keys.map((key) => (
                  <tr
                    key={key.id}
                    className={
                      key.revokedAt !== null
                        ? 'opacity-55'
                        : 'transition-colors hover:bg-surface-sunken'
                    }
                  >
                    <td className="px-5 py-3.5">
                      <span className="font-medium text-ink">{key.name}</span>
                      {key.revokedAt !== null && (
                        <Chip className="ml-2 bg-mute-soft text-mute ring-1 ring-mute/25">
                          Revoked
                        </Chip>
                      )}
                    </td>
                    <td className="px-5 py-3.5 font-mono text-[13px] text-ink-muted">
                      {key.masked}
                    </td>
                    <td className="whitespace-nowrap px-5 py-3.5 text-ink-muted">
                      {formatDateTime(key.createdAt)}
                    </td>
                    <td className="whitespace-nowrap px-5 py-3.5 text-ink-muted">
                      {key.lastUsedAt === null ? (
                        <span className="text-ink-subtle">Never</span>
                      ) : (
                        formatDateTime(key.lastUsedAt)
                      )}
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      {key.revokedAt === null && (
                        <button
                          type="button"
                          onClick={() => revoke(key)}
                          disabled={busy}
                          aria-label={`Revoke ${key.name}`}
                          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[13px] font-medium text-ink-subtle transition-colors hover:bg-bad-soft hover:text-bad disabled:opacity-50"
                        >
                          <Trash className="h-3.5 w-3.5" />
                          Revoke
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
