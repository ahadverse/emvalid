import type { Advice, JobSummary, MxProvider, ReasonCode } from '@ev/core';
import {
  ADVICE_ORDER,
  ADVICE_STYLES,
  FLAG_LABELS,
  formatCount,
  formatPercent,
  providerLabel,
  SHOW_UNKNOWN_AS_DELIVERABLE,
  statusRows,
  summaryReasonLabel,
} from '@/lib/format';
import { Alert, Check, Clock, Globe, Layers, Search, Shield } from './icons';
import { Card, CardHeader, Meter, Notice, SectionLabel, Stat } from './ui';

/**
 * Feature 18 — the breakdown a finished job produces.
 *
 * The first block answers the question the user came with: of the list I
 * uploaded, how much can I mail? That is `byAdvice`, and it leads. Coverage and
 * the unknown share are still here, one card down, because a buyer deserves to
 * know how much we proved versus how much we merely found no fault with — but
 * leading with "75% unknown" answered a question nobody asked and made a
 * working tool look broken.
 */
export function SummaryView({ summary }: { summary: JobSummary }) {
  const { total, byStatus, byAdvice } = summary;
  const unknownShare = total === 0 ? 0 : (byStatus.unknown / total) * 100;
  const actionable = byStatus.undeliverable + byStatus.risky;
  const keepShare = total === 0 ? 0 : (byAdvice.send / total) * 100;
  const removedShare = total === 0 ? 0 : (byAdvice.do_not_send / total) * 100;

  const reasons = (Object.entries(summary.byReason) as [ReasonCode, number][])
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1]);

  const providers = (Object.entries(summary.byProvider) as [MxProvider, number][])
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1]);

  const providerTotal = providers.reduce((sum, [, count]) => sum + count, 0);

  const flags = (Object.keys(FLAG_LABELS) as (keyof typeof FLAG_LABELS)[])
    .map((flag) => [flag, summary.flags[flag]] as const)
    .filter(([, count]) => count > 0);

  return (
    <div className="space-y-8">
      <section>
        <SectionLabel>Result</SectionLabel>

        <Card>
          <CardHeader
            title="Your list, cleaned"
            description="What to keep, what to look at, and what to drop."
            icon={Shield}
          />

          <div className="px-5 pt-5">
            <AdviceBar byAdvice={byAdvice} total={total} />
          </div>

          <div className="grid gap-3 px-5 py-5 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label="Safe to send"
              value={formatCount(byAdvice.send)}
              hint={`${formatPercent(Math.round(keepShare * 10) / 10)} of the list`}
              accent="text-good"
              icon={Check}
            />
            <Stat
              label="Check first"
              value={formatCount(byAdvice.review)}
              hint="Role addresses and suspected typos"
              accent={byAdvice.review > 0 ? 'text-warn' : 'text-ink'}
              icon={Search}
            />
            <Stat
              label="Remove"
              value={formatCount(byAdvice.do_not_send)}
              hint={`${formatPercent(Math.round(removedShare * 10) / 10)} would have bounced or burned`}
              accent={byAdvice.do_not_send > 0 ? 'text-bad' : 'text-ink'}
              icon={Alert}
            />
            <Stat
              label="Retry"
              value={formatCount(byAdvice.retry)}
              hint="We were blocked from checking these"
              accent={byAdvice.retry > 0 ? 'text-warn' : 'text-ink'}
              icon={Clock}
            />
          </div>

          <div className="border-t border-line px-5 py-4">
            <p className="text-[13px] leading-relaxed text-ink-subtle">
              {formatCount(byAdvice.do_not_send + byAdvice.review)} addresses were going to cost you
              something — a bounce, a complaint, or a reply nobody reads. They are marked in the
              downloaded file, so you can filter on the{' '}
              <span className="font-mono text-ink-muted">advice</span> column and keep moving.
            </p>
          </div>
        </Card>
      </section>

      <section>
        <SectionLabel>Confidence in this run</SectionLabel>

        <Card>
          <CardHeader
            title="Coverage"
            description="How much of this list we were able to give a firm answer on."
            icon={Layers}
          />

          <div className="grid gap-3 px-5 py-5 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label="Coverage"
              value={formatPercent(summary.coverage)}
              hint={`${formatCount(actionable)} rows you can act on`}
              accent="text-ink"
            />
            {/*
              Tracks the "By status" label below it. Two panels on one screen
              calling the same number by two different names is worse than
              either name on its own.
            */}
            <Stat
              label={SHOW_UNKNOWN_AS_DELIVERABLE ? 'Deliverable' : 'Unknown'}
              value={formatPercent(Math.round(unknownShare * 10) / 10)}
              hint={
                SHOW_UNKNOWN_AS_DELIVERABLE
                  ? `${formatCount(byStatus.unknown)} rows passed every check`
                  : `${formatCount(byStatus.unknown)} rows left undecided`
              }
              accent={SHOW_UNKNOWN_AS_DELIVERABLE ? 'text-good' : 'text-mute'}
            />
            <Stat
              label="Rows verified"
              value={formatCount(total)}
              hint={`${formatCount(summary.duplicates)} duplicates removed`}
            />
            <Stat
              label="Awaiting retry"
              value={formatCount(summary.retryable)}
              hint="DNS failed — not an answer"
              accent={summary.retryable > 0 ? 'text-warn' : 'text-ink'}
            />
          </div>

          <div className="border-t border-line px-5 py-4">
            {SHOW_UNKNOWN_AS_DELIVERABLE ? (
              /*
                The headline says Deliverable; this is where the report says what
                that rests on. Deleting this paragraph rather than rewording it
                would leave the number unqualified, which is the one version of
                this screen that would actually be dishonest.
              */
              <Notice title="What “deliverable” rests on here">
                These addresses are well formed, their domains exist and accept mail, and nothing
                about them is disposable, shared or mistyped. What no verification tool can tell you
                — ours included — is whether one particular mailbox on a live domain is occupied;
                the large providers answer that question for nobody. The coverage figure above
                counts only the rows we can prove something about, and that is the stricter number
                of the two.
              </Notice>
            ) : (
              <Notice title="Why so much of this list is unknown">
                Coverage counts only the rows we can prove something about: undeliverable addresses
                and risky ones. Everything else passed every check — but a domain having a mail
                server never proves that one particular mailbox on it exists, and the large
                providers do not answer that question for anybody. Calling those addresses valid
                would be printing <span className="text-ink">unknown</span> in a nicer font. The
                value of this list is in what it removes: dead domains, typos, disposable addresses
                and shared inboxes are the bulk of what makes a campaign bounce, and those are
                caught with certainty.
              </Notice>
            )}
          </div>
        </Card>
      </section>

      <section>
        <SectionLabel>Breakdown</SectionLabel>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader title="By status" description="The verdict on every row." />
            <div className="space-y-4 px-5 py-5">
              {statusRows(byStatus).map((row) => (
                <Meter
                  key={row.key}
                  label={row.label}
                  count={row.count}
                  total={total}
                  barClass={row.bar}
                  note={row.blurb}
                />
              ))}
            </div>
          </Card>

          <Card>
            <CardHeader
              title="By reason"
              description={
                // "Why each row got the verdict it did" stops being true once
                // one of the rows is named after the verdict rather than a
                // finding, so the description follows the same switch.
                SHOW_UNKNOWN_AS_DELIVERABLE
                  ? 'What each row came back as.'
                  : 'Why each row got the verdict it did.'
              }
            />
            {reasons.length === 0 ? (
              <p className="px-5 py-5 text-sm text-ink-muted">No rows were classified.</p>
            ) : (
              <ul className="divide-y divide-line">
                {reasons.map(([reason, count]) => (
                  <li
                    key={reason}
                    className="flex items-baseline justify-between gap-4 px-5 py-3 transition-colors hover:bg-surface-sunken"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm text-ink">{summaryReasonLabel(reason)}</p>
                      <p className="font-mono text-xs text-ink-subtle">{reason}</p>
                    </div>
                    {/* Same two columns as Meter, so the two panels side by
                        side share one set of gridlines. */}
                    <p className="flex shrink-0 items-baseline gap-3 text-sm tabular-nums">
                      <span className="min-w-[3rem] text-right font-medium text-ink-muted">
                        {formatCount(count)}
                      </span>
                      <span className="w-14 text-right text-ink-subtle">
                        {formatPercent(total === 0 ? 0 : (count / total) * 100)}
                      </span>
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader
              title="By mail provider"
              description="Who actually runs the mail for these domains."
              icon={Globe}
            />
            {providers.length === 0 ? (
              <p className="px-5 py-5 text-sm text-ink-muted">
                No provider was identified — that happens when no row reached a DNS lookup.
              </p>
            ) : (
              <div className="space-y-4 px-5 py-5">
                {providers.map(([provider, count]) => (
                  <Meter
                    key={provider}
                    label={providerLabel(provider)}
                    count={count}
                    total={providerTotal}
                  />
                ))}
                <p className="pt-1 text-xs leading-relaxed text-ink-subtle">
                  Shares are of the {formatCount(providerTotal)} rows whose domain resolved to a
                  mail server, not of the whole list.
                </p>
              </div>
            )}
          </Card>

          <Card>
            <CardHeader
              title="Flags"
              description="Signals raised alongside the verdict. A row can carry several."
            />
            {flags.length === 0 ? (
              <p className="px-5 py-5 text-sm text-ink-muted">No flags were raised.</p>
            ) : (
              <ul className="divide-y divide-line">
                {flags.map(([flag, count]) => (
                  <li key={flag} className="flex items-baseline justify-between gap-4 px-5 py-3">
                    <span className="text-sm text-ink">{FLAG_LABELS[flag]}</span>
                    <span className="shrink-0 text-sm font-medium tabular-nums text-ink-muted">
                      {formatCount(count)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <div className="border-t border-line px-5 py-3.5">
              <div className="flex items-baseline justify-between gap-4">
                <span className="text-sm text-ink">Duplicates removed</span>
                <span className="text-sm font-medium tabular-nums text-ink-muted">
                  {formatCount(summary.duplicates)}
                </span>
              </div>
              <p className="mt-1 text-xs leading-relaxed text-ink-subtle">
                Alias-aware: dots and +tags are collapsed first, so two spellings of one Gmail
                mailbox count once.
              </p>
            </div>
          </Card>
        </div>
      </section>
    </div>
  );
}

/**
 * The whole list as one bar.
 *
 * Four numbers in four boxes make the reader do the division; one bar does it
 * for them, and the proportion is the only thing anybody actually wants from
 * this block. The four `Stat` tiles directly beneath still carry the exact
 * counts, so nothing here is the sole source of a figure — a 0.4% slice is two
 * pixels wide and must not be the only place a number appears.
 */
function AdviceBar({
  byAdvice,
  total,
}: {
  byAdvice: Record<Advice, number>;
  total: number;
}) {
  if (total === 0) return null;

  const segments = ADVICE_ORDER.map((advice) => ({
    advice,
    count: byAdvice[advice],
    share: (byAdvice[advice] / total) * 100,
    style: ADVICE_STYLES[advice],
  })).filter((segment) => segment.count > 0);

  return (
    <div>
      <div className="flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full bg-line">
        {segments.map((segment) => (
          <div
            key={segment.advice}
            className={`h-full transition-[width] duration-700 ${segment.style.bar}`}
            style={{ width: `${segment.share}%` }}
            title={`${segment.style.label}: ${formatCount(segment.count)}`}
          />
        ))}
      </div>

      <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5">
        {segments.map((segment) => (
          <li key={segment.advice} className="flex items-center gap-2 text-[13px]">
            <span
              aria-hidden
              className={`h-2 w-2 shrink-0 rounded-full ${segment.style.bar}`}
            />
            <span className="text-ink-muted">{segment.style.label}</span>
            <span className="tabular-nums text-ink-subtle">
              {formatPercent(Math.round(segment.share * 10) / 10)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
