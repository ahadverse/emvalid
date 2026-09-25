import type { Check, EmailResult } from '@ev/core';
import { ADVICE_STYLES, providerLabel, reasonLabel } from '@/lib/format';
import { CheckList } from './check-list';
import { Field, Notice } from './ui';

/**
 * The full result of one address.
 *
 * This is the view that has to earn the sale, and the way it does that is by
 * refusing to round anything off. Status, confidence, reason code, the exact
 * `detail` sentence from the engine, the suggestion and every individual check
 * are on screen at once — including the part most tools hide, which is that we
 * did not check the mailbox.
 *
 * There is no separate "flags" list any more: role, disposable, free provider,
 * IDN and alias each have their own row in the audit trail, with a sentence
 * rather than a bullet. Printing both would be the same finding twice, which
 * is how a report starts feeling padded.
 */

export function ResultView({ result, checks }: { result: EmailResult; checks: readonly Check[] }) {
  /**
   * Only `advice` is rendered. `status` stays in the API and in the result
   * model, but it is not shown: with no mailbox-level check, roughly seven in
   * ten rows carry the same status, and a screen where everything says the
   * same word carries no information at all — it only makes a working tool
   * look like it failed. The precise finding is still on screen, in the
   * `detail` sentence, which says outright that the mailbox was not confirmed.
   */
  const style = ADVICE_STYLES[result.advice];

  /**
   * The number means two different things depending on the verdict, and saying
   * which is the difference between a useful score and a decorative one. This
   * wording tracks the comments in packages/core/src/classify.ts.
   *
   * Computed once and shown twice — as the ring's caption and as the sentence
   * under the verdict — so the short form and the long form can never disagree
   * about what the figure measures.
   */
  const measures =
    result.status === 'unknown'
      ? 'how likely this domain is to accept mail'
      : `how sure we are that “${style.label.toLowerCase()}” is the right call`;

  const explanation =
    result.status === 'unknown'
      ? 'Confidence here is read from the domain’s DNS records — it is not a claim about this individual mailbox.'
      : `Confidence is how sure we are of the verdict itself, not how good the address is. A high number beside “${style.label}” means we are certain it should be ${style.label.toLowerCase()}.`;

  return (
    <div className="divide-y divide-line">
      {/* -------------------------------------------------- Verdict */}
      <div className={`flex flex-wrap items-center justify-between gap-5 px-5 py-5 ${style.wash}`}>
        <div className="min-w-0">
          <p className="truncate font-mono text-[13px] text-ink-muted">{result.input}</p>
          <p className={`mt-1.5 text-xl font-semibold tracking-tight ${style.text}`}>
            {style.label}
          </p>
          <p className="mt-1 text-[13px] leading-relaxed text-ink-muted">
            {reasonLabel(result.reason)} · {style.blurb}
          </p>
        </div>

        <ConfidenceRing
          value={result.confidence}
          className={style.text}
          measures={measures}
        />
      </div>

      {/* -------------------------------------------------- Detail */}
      <div className="space-y-3 px-5 py-4">
        <p className="text-sm leading-relaxed text-ink">{result.detail}</p>

        <p className="text-[13px] leading-relaxed text-ink-subtle">{explanation}</p>

        {result.retryable && (
          <Notice tone="warn">
            This answer may change. DNS did not respond, so nothing about the domain was
            established — a retry is owed before this result is acted on.
          </Notice>
        )}
      </div>

      {/* -------------------------------------------------- Suggestion */}
      {result.suggestion !== null && (
        <div className="px-5 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-accent-line bg-accent-soft px-4 py-3">
            <div className="min-w-0">
              <p className="text-[11px] font-medium uppercase tracking-wider text-ink-subtle">
                Suggested correction
              </p>
              <p className="mt-1 truncate font-mono text-sm text-ink">{result.suggestion}</p>
            </div>
            <p className="text-[13px] text-ink-muted">
              The domain is one edit away from a much larger one.
            </p>
          </div>
        </div>
      )}

      <CheckList checks={checks} />

      {/* -------------------------------------------------- Facts */}
      <dl className="grid grid-cols-1 gap-x-6 gap-y-4 px-5 py-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field
          label="Normalized"
          value={<span className="font-mono">{result.normalized ?? '—'}</span>}
        />
        <Field
          label="Canonical mailbox"
          value={<span className="font-mono">{result.canonical ?? '—'}</span>}
        />
        <Field
          label="Domain"
          value={
            <span className="font-mono">
              {result.domain ?? '—'}
              {result.domainUnicode !== null && (
                <span className="ml-2 text-ink-subtle">({result.domainUnicode})</span>
              )}
            </span>
          }
        />
        <Field
          label="Mail provider"
          value={
            result.flags.mxProvider === null ? (
              <span className="text-ink-subtle">Not determined</span>
            ) : (
              providerLabel(result.flags.mxProvider)
            )
          }
        />
        <Field label="Reason code" value={<span className="font-mono">{result.reason}</span>} />
        <Field label="Retryable" value={result.retryable ? 'Yes' : 'No'} />
      </dl>

      {result.advice === 'send' && (
        <div className="px-5 py-4">
          <p className="text-[13px] leading-relaxed text-ink-subtle">
            The address is well formed, the domain is real and accepts mail, and nothing about it
            looks disposable, shared or mistyped. Whether this exact mailbox is occupied is not
            something any receiving provider reveals — to anyone — so we record that as not
            confirmed rather than claiming it. Send with confidence; this is as clean as an
            address gets.
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * How strong the number is, in words.
 *
 * A bare "80" is only meaningful to someone who has seen enough of these to
 * know the range. The band is what makes the first one readable, and the
 * thresholds are wide on purpose — this is a plain-language gloss, not a
 * second scoring system to reconcile against the first.
 */
function confidenceBand(value: number): string {
  if (value >= 90) return 'Very high';
  if (value >= 75) return 'High';
  if (value >= 50) return 'Moderate';
  return 'Low';
}

/**
 * Confidence as an arc, a number, a word and a sentence.
 *
 * A ring is read at a glance and a two-digit number is not, which matters
 * because this figure is the one thing on the report a user compares between
 * two addresses. But an arc alone says "80 out of 100" and stops — so the band
 * says how strong that is, and `measures` says what it is measuring. Without
 * that last line the obvious misreading is "80% chance the email is good",
 * which is not what any of these numbers mean.
 */
function ConfidenceRing({
  value,
  className,
  measures,
}: {
  value: number;
  className: string;
  /** Completes the sentence "Confidence — …". Never omitted. */
  measures: string;
}) {

  const RADIUS = 26;
  const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
  const clamped = Math.max(0, Math.min(100, value));

  return (
    <div className="flex shrink-0 items-center gap-3.5">
      <div className="relative h-16 w-16 shrink-0">
        <svg viewBox="0 0 64 64" className="h-16 w-16 -rotate-90" aria-hidden>
          <circle
            cx="32"
            cy="32"
            r={RADIUS}
            fill="none"
            stroke="currentColor"
            strokeWidth="6"
            className="text-line"
          />
          <circle
            cx="32"
            cy="32"
            r={RADIUS}
            fill="none"
            stroke="currentColor"
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={CIRCUMFERENCE * (1 - clamped / 100)}
            className={className}
          />
        </svg>
        {/*
          The ring is decoration for the number, so the accessible reading is
          built here rather than left to a screen reader tracing an arc.
        */}
        <span className="sr-only">
          Confidence {clamped} out of 100 — {confidenceBand(clamped).toLowerCase()}. Measures{' '}
          {measures}.
        </span>
        <span
          aria-hidden
          className={`absolute inset-0 grid place-items-center text-lg font-semibold tabular-nums ${className}`}
        >
          {clamped}
        </span>
      </div>

      <div aria-hidden className="max-w-[13rem]">
        <p className="text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-subtle">
          Confidence
        </p>
        <p className={`text-sm font-semibold leading-tight ${className}`}>
          {confidenceBand(clamped)}
        </p>
        <p className="mt-0.5 text-[11px] leading-snug text-ink-subtle">{measures}</p>
      </div>
    </div>
  );
}
