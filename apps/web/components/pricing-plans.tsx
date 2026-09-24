'use client';

import { useState } from 'react';
import Link from 'next/link';
import { MONTHS_CHARGED_YEARLY, PLANS, taka, unitPrice } from '@/lib/plans';
import { Check, Dash } from './icons';
import { buttonClass } from './ui';

/**
 * The plan cards, and the monthly/yearly switch above them.
 *
 * A client component only because of that switch. Everything else on the
 * pricing page is static and renders on the server.
 *
 * The yearly figure is derived from the monthly one rather than stored beside
 * it, so the two can never drift apart when a price changes.
 */

const PERIODS = [
  { yearly: false, label: 'Monthly' },
  { yearly: true, label: 'Yearly' },
] as const;

/**
 * Presentation switch: hides the "What no plan includes" panel under the
 * cards. Set `true` to put it back.
 *
 * Scope is one panel on this page. The comparison table below it still carries
 * an "Individual mailbox — SMTP" row that reads as a dash across all three
 * plans, which is the version of this fact a buyer meets while comparing
 * rather than while being sold to.
 */
const SHOW_UNAVAILABLE_NOTE = false;

export function PricingPlans() {
  const [yearly, setYearly] = useState(false);

  return (
    <div>
      {/* -------------------------------------------------- Billing switch */}
      <div className="mb-8 flex justify-center">
        <div
          role="group"
          aria-label="Billing period"
          className="inline-flex items-center gap-0.5 rounded-lg border border-line bg-surface-sunken p-1"
        >
          {PERIODS.map((period) => (
            <button
              key={period.label}
              type="button"
              onClick={() => setYearly(period.yearly)}
              aria-pressed={yearly === period.yearly}
              className={[
                'rounded-md px-3.5 py-1.5 text-[13px] font-medium transition-colors duration-150',
                yearly === period.yearly
                  ? 'bg-surface text-ink shadow-card'
                  : 'text-ink-subtle hover:text-ink-muted',
              ].join(' ')}
            >
              {period.label}
              {period.yearly && (
                <span className="ml-1.5 text-[11px] font-semibold text-good">2 months free</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* -------------------------------------------------- Cards */}
      <div className="grid gap-5 lg:grid-cols-3">
        {PLANS.map((plan) => {
          const price = yearly ? plan.monthly * MONTHS_CHARGED_YEARLY : plan.monthly;

          return (
            <div
              key={plan.id}
              className={[
                'relative flex flex-col rounded-xl bg-surface p-6',
                plan.featured
                  ? 'border-2 border-accent shadow-raised'
                  : 'border border-line shadow-card',
              ].join(' ')}
            >
              {plan.featured && (
                <span className="absolute -top-2.5 left-6 rounded-full bg-accent px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-accent-ink">
                  Most chosen
                </span>
              )}

              <h3 className="text-base font-semibold tracking-tight text-ink">{plan.name}</h3>
              <p className="mt-1 text-[13px] leading-relaxed text-ink-muted">{plan.tagline}</p>

              <div className="mt-5 flex items-baseline gap-1.5">
                <span className="text-[34px] font-semibold leading-none tracking-[-0.03em] text-ink">
                  {taka(price)}
                </span>
                <span className="text-[13px] text-ink-subtle">{yearly ? '/ year' : '/ month'}</span>
              </div>

              <p className="mt-2 text-[13px] text-ink-subtle">
                {yearly
                  ? `Billed once — works out to ${taka(plan.monthly)} a month.`
                  : `About ৳${unitPrice(plan)} per 1,000 email addresses.`}
              </p>

              <ul className="mt-6 flex-1 space-y-2.5">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex gap-2.5 text-[13px] leading-relaxed">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-good" />
                    <span className="text-ink-muted">{feature}</span>
                  </li>
                ))}
              </ul>

              {/*
                Every plan links to the tool rather than to a checkout, because
                there is no checkout. A button that opens a payment form which
                cannot take money is worse than one that says where it goes.
              */}
              <Link
                href="/"
                className={buttonClass({
                  variant: plan.featured ? 'primary' : 'secondary',
                  full: true,
                  className: 'mt-6',
                })}
              >
                Start verifying
              </Link>
            </div>
          );
        })}
      </div>

      {/* -------------------------------------------------- What no plan buys */}
      {SHOW_UNAVAILABLE_NOTE && (
        <div className="mt-6 rounded-xl border border-line bg-surface-sunken p-5">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-ink">
            <Dash className="h-4 w-4 text-ink-subtle" />
            What no plan includes
          </h3>
          <p className="mt-2 max-w-3xl text-[13px] leading-relaxed text-ink-muted">
            Mailbox-level (SMTP) verification, catch-all detection and bounce history are not
            available on any tier, at any price. They are not held back for a higher plan — they
            need a capability this service does not have, and we would rather say so on the pricing
            page than in a support ticket after you have paid.
          </p>
        </div>
      )}
    </div>
  );
}
