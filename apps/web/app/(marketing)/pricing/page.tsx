import { Fragment } from 'react';
import Link from 'next/link';
import { MAX_UPLOAD_BYTES } from '@/lib/config';
import { formatBytes } from '@/lib/format';
import { PLANS, unitPrice } from '@/lib/plans';
import { PricingPlans } from '@/components/pricing-plans';
import { ArrowRight, Bolt, Check, Dash, Shield } from '@/components/icons';
import {
  buttonClass,
  Card,
  CardHeader,
  Eyebrow,
  Notice,
  PageHeader,
  SectionLabel,
} from '@/components/ui';

export const metadata = {
  title: 'Pricing',
  description:
    'Three plans, priced per month in taka. What every plan includes, and what no plan includes.',
};

/**
 * Pricing.
 *
 * The rule this page is written to: nothing on it may be a claim the product
 * cannot back. That is why the "what no plan includes" block sits between the
 * cards and the comparison table rather than in a footnote, and why the
 * comparison table has a row for mailbox verification that reads as a dash all
 * the way across. A buyer who discovers that limit after paying is a refund;
 * one who reads it here is a customer with correct expectations.
 */

/** `true` renders a tick, `false` a dash, a string renders as itself. */
type Cell = string | boolean;

interface ComparisonRow {
  label: string;
  note?: string;
  cells: readonly [Cell, Cell, Cell];
}

const COMPARISON: readonly { group: string; rows: readonly ComparisonRow[] }[] = [
  {
    group: 'Volume',
    rows: [
      {
        label: 'Verifications a month',
        cells: ['10,000', '25,000', '100,000'],
      },
      {
        label: 'Price per 1,000 email addresses',
        cells: [
          `৳${unitPrice(PLANS[0]!)}`,
          `৳${unitPrice(PLANS[1]!)}`,
          `৳${unitPrice(PLANS[2]!)}`,
        ],
      },
      {
        label: 'Unused credits roll over',
        note: 'One month only — credits do not accumulate indefinitely.',
        cells: [false, false, true],
      },
    ],
  },
  {
    group: 'Verification',
    rows: [
      {
        label: 'Syntax — RFC 5321 / 5322',
        cells: [true, true, true],
      },
      {
        label: 'Domain and MX — live DNS',
        cells: [true, true, true],
      },
      {
        label: 'Policy — disposable, role, typo, provider',
        cells: [true, true, true],
      },
      {
        label: 'Individual mailbox — SMTP',
        note: 'Not offered on any plan. No provider allows it to be established reliably from outside.',
        cells: [false, false, false],
      },
      {
        label: 'Alias-aware duplicate removal',
        cells: [true, true, true],
      },
      {
        label: 'Per-row reason, confidence and detail',
        cells: [true, true, true],
      },
    ],
  },
  {
    group: 'Platform',
    rows: [
      { label: 'API access', cells: [true, true, true] },
      { label: 'API requests a minute', cells: ['60', '120', '300'] },
      { label: 'Priority processing queue', cells: [false, true, true] },
      { label: 'Result retention', cells: ['7 days', '14 days', '30 days'] },
      { label: 'Support', cells: ['Email', 'Priority email', 'Direct line'] },
    ],
  },
];

const FAQ: readonly { question: string; answer: string }[] = [
  {
    question: 'What counts as one verification?',
    answer:
      'One address that reaches the engine. Duplicates are collapsed before verification — alias-aware, so two spellings of the same Gmail mailbox count once — and syntactically invalid rows are rejected without a DNS lookup. You are billed for the work done, not for the rows in your file.',
  },
  {
    question: 'What happens when I use up the month?',
    answer:
      'Jobs stop being accepted until the quota resets or you move up a plan. Nothing already uploaded is discarded, and no row is silently marked unknown to stay inside a limit — a result you were not charged for is a result you never receive, not a wrong one.',
  },
  {
    question: 'Why is there no free plan?',
    answer:
      'Every verification is a live DNS lookup against somebody else’s infrastructure. A free tier on this kind of service is used, overwhelmingly, to check lists that were never opted in — which gets the resolver rate-limited and makes the paid tiers slower. The single-address check on the verify page is free and unlimited.',
  },
  {
    question: 'Can you promise 99% accuracy?',
    answer:
      'No, and neither can anybody else without SMTP-level checks. What we can promise is that what we do say is correct: an address we call undeliverable is provably undeliverable. Expect roughly a quarter of a real list to come back with a firm verdict; every job summary shows you that ratio for your own list.',
  },
  {
    question: 'How do I pay?',
    answer:
      'Online checkout is not live yet. The prices above are the intended plans; until billing is switched on, the dashboard and the API are usable and nothing is metered. Existing users will be told before that changes.',
  },
  {
    question: 'What happens to my list after a job finishes?',
    answer:
      'The uploaded file, the result file and every address row are deleted automatically once the retention window for your plan passes. Retention is enforced by a scheduled job, not by a promise — the deletion timestamp is shown on every job page before the job even starts.',
  },
];

export default function PricingPage() {
  return (
    <div className="space-y-14">
      {/* -------------------------------------------------- Header */}
      <section className="relative isolate text-center">
        <div
          aria-hidden
          className="bg-grid pointer-events-none absolute inset-x-0 -top-14 -z-10 h-64 opacity-60"
        />

        <div className="mx-auto max-w-2xl animate-rise">
          <Eyebrow icon={Bolt} tone="accent">
            Pricing
          </Eyebrow>
          <h1 className="mt-4 text-[34px] font-semibold leading-[1.1] tracking-[-0.03em] text-ink sm:text-[40px]">
            Priced by the list, not by the seat
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-[15px] leading-relaxed text-ink-muted">
            Three plans in taka. Every plan runs the same three verification layers on every
            address — the tiers differ in volume, speed and how long results are kept, never in how
            carefully your list is checked.
          </p>
        </div>
      </section>

      {/* -------------------------------------------------- Plans */}
      <section>
        <PricingPlans />
      </section>

      {/* -------------------------------------------------- Billing status */}
      <section>
        <Notice tone="accent" title="Billing is not switched on yet">
          The plans above are what the service will cost. Until online payment is live, the
          dashboard and the API work and nothing is metered — you can upload a real list today and
          see exactly what you would be paying for. Anyone using it will be told before that
          changes.
        </Notice>
      </section>

      {/* -------------------------------------------------- Comparison */}
      <section>
        <SectionLabel>Compare plans</SectionLabel>

        <Card>
          <div className="scroll-x">
            <table className="w-full min-w-3xl text-sm">
              <thead>
                <tr className="border-b border-line">
                  <th className="w-[38%] px-5 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">
                    Feature
                  </th>
                  {PLANS.map((plan) => (
                    <th key={plan.id} className="px-5 py-3 text-center">
                      <div className="text-sm font-semibold text-ink">{plan.name}</div>
                      <div className="mt-0.5 text-[13px] font-normal tabular-nums text-ink-subtle">
                        ৳{plan.monthly.toLocaleString('en-US')}/mo
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody>
                {COMPARISON.map((section) => (
                  <Fragment key={section.group}>
                    <tr className="bg-surface-sunken">
                      <th
                        colSpan={4}
                        className="px-5 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-subtle"
                      >
                        {section.group}
                      </th>
                    </tr>

                    {section.rows.map((row) => (
                      <tr
                        key={row.label}
                        className="border-t border-line transition-colors hover:bg-surface-sunken"
                      >
                        <td className="px-5 py-3">
                          <span className="text-ink">{row.label}</span>
                          {row.note !== undefined && (
                            <span className="mt-0.5 block text-xs leading-relaxed text-ink-subtle">
                              {row.note}
                            </span>
                          )}
                        </td>
                        {row.cells.map((cell, index) => (
                          <td
                            key={`${row.label}-${PLANS[index]?.id ?? index}`}
                            className="px-5 py-3 text-center tabular-nums text-ink-muted"
                          >
                            <ComparisonCell value={cell} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </Fragment>
                ))}

                <tr className="border-t border-line">
                  <td className="px-5 py-3 text-ink">Maximum upload size</td>
                  <td colSpan={3} className="px-5 py-3 text-center text-ink-muted">
                    {formatBytes(MAX_UPLOAD_BYTES)} on every plan — files stream to disk, so size
                    is not what limits a job
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </Card>
      </section>

      {/* -------------------------------------------------- FAQ */}
      <section>
        <SectionLabel>Questions</SectionLabel>

        <div className="grid gap-4 md:grid-cols-2">
          {FAQ.map((entry) => (
            <Card key={entry.question} className="p-5">
              <h3 className="text-sm font-semibold tracking-tight text-ink">{entry.question}</h3>
              <p className="mt-2 text-[13px] leading-relaxed text-ink-muted">{entry.answer}</p>
            </Card>
          ))}
        </div>
      </section>

      {/* -------------------------------------------------- Close */}
      <section>
        <Card>
          <CardHeader
            title="Try it on a real list first"
            description="Nothing is metered yet, so the honest way to judge this is to run a list you already have and read the coverage figure."
            icon={Shield}
          />
          <div className="flex flex-wrap items-center gap-3 px-5 py-5">
            <Link href="/" className={buttonClass({ size: 'lg' })}>
              Verify a list
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="/keys"
              className={buttonClass({ variant: 'secondary', size: 'lg' })}
            >
              Read the API docs
            </Link>
          </div>
        </Card>
      </section>
    </div>
  );
}

function ComparisonCell({ value }: { value: Cell }) {
  if (value === true) {
    return (
      <>
        <Check className="mx-auto h-4 w-4 text-good" aria-hidden />
        <span className="sr-only">Included</span>
      </>
    );
  }

  if (value === false) {
    return (
      <>
        <Dash className="mx-auto h-4 w-4 text-ink-subtle" aria-hidden />
        <span className="sr-only">Not included</span>
      </>
    );
  }

  return <>{value}</>;
}
