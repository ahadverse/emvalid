'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { MONTHS_CHARGED_YEARLY, PLANS, taka } from '@/lib/plans';
import { Check, Spinner } from './icons';
import { buttonClass, Notice } from './ui';

/**
 * Places an order. It does not take money and does not pretend to.
 *
 * The button says "Place order" rather than "Pay" for that reason — the next
 * screen is instructions, not a card form. When a gateway is wired up this is
 * the component that gains a redirect; the server side already produces the
 * row a gateway callback would settle.
 */
export function BuyPlan({ currentPlanId }: { currentPlanId: string | null }) {
  const router = useRouter();

  const [yearly, setYearly] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function order(planId: string): Promise<void> {
    if (pendingId !== null) return;

    setPendingId(planId);
    setError(null);

    try {
      const response = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId, yearly }),
      });

      const body: unknown = await response.json();

      if (!response.ok) {
        setError(
          (body as { error?: { message?: string } }).error?.message ??
            `Could not place the order (HTTP ${response.status}).`,
        );
        return;
      }

      // The order list is server-rendered on this same page.
      router.refresh();
    } catch {
      setError('Could not reach the server.');
    } finally {
      setPendingId(null);
    }
  }

  return (
    <div className="px-5 py-5">
      {error !== null && (
        <div className="mb-4">
          <Notice tone="bad">{error}</Notice>
        </div>
      )}

      <div className="mb-4 flex justify-center">
        <div
          role="group"
          aria-label="Billing period"
          className="inline-flex items-center gap-0.5 rounded-lg border border-line bg-surface-sunken p-1"
        >
          {[
            { value: false, label: 'Monthly' },
            { value: true, label: 'Yearly' },
          ].map((option) => (
            <button
              key={option.label}
              type="button"
              onClick={() => setYearly(option.value)}
              aria-pressed={yearly === option.value}
              className={[
                'rounded-md px-3.5 py-1.5 text-[13px] font-medium transition-colors duration-150',
                yearly === option.value
                  ? 'bg-surface text-ink shadow-card'
                  : 'text-ink-subtle hover:text-ink-muted',
              ].join(' ')}
            >
              {option.label}
              {option.value && (
                <span className="ml-1.5 text-[11px] font-semibold text-good">2 months free</span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {PLANS.map((plan) => {
          const amount = yearly ? plan.monthly * MONTHS_CHARGED_YEARLY : plan.monthly;
          const credits = plan.quota * (yearly ? 12 : 1);
          const current = plan.id === currentPlanId;
          const busy = pendingId === plan.id;

          return (
            <div
              key={plan.id}
              className={[
                'flex flex-col rounded-xl bg-surface p-4',
                current ? 'border-2 border-accent' : 'border border-line',
              ].join(' ')}
            >
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-ink">{plan.name}</h3>
                {current && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent">
                    <Check className="h-3 w-3" />
                    Current
                  </span>
                )}
              </div>

              <p className="mt-2 text-[22px] font-semibold leading-none tracking-[-0.02em] text-ink">
                {taka(amount)}
                <span className="ml-1 text-[13px] font-normal text-ink-subtle">
                  /{yearly ? 'yr' : 'mo'}
                </span>
              </p>

              <p className="mt-1.5 flex-1 text-xs leading-relaxed text-ink-muted">
                Adds {credits.toLocaleString('en-US')} credits and{' '}
                {yearly ? '12 months' : '1 month'} of access.
              </p>

              <button
                type="button"
                onClick={() => order(plan.id)}
                disabled={pendingId !== null}
                className={buttonClass({
                  variant: current ? 'secondary' : 'primary',
                  size: 'sm',
                  full: true,
                  className: 'mt-4',
                })}
              >
                {busy && <Spinner className="h-3.5 w-3.5" />}
                {busy ? 'Placing…' : current ? 'Renew' : 'Place order'}
              </button>
            </div>
          );
        })}
      </div>

      <p className="mt-4 text-center text-xs leading-relaxed text-ink-subtle">
        Placing an order does not charge anything. It records what you want to buy and shows you
        how to pay; credits arrive once the payment is confirmed.
      </p>
    </div>
  );
}
