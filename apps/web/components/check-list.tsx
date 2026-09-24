import type { ComponentType } from 'react';
import type { Check, CheckOutcome } from '@ev/core';
import { CHECK_OUTCOME_STYLES } from '@/lib/format';
import { Alert, Check as CheckMark, Close, Dash, Info, type IconProps } from './icons';

/**
 * The audit trail — one row per check the engine ran.
 *
 * The verdict at the top of the report is the answer; this is the working.
 * It exists because the objection to a cheap verification tool is never "the
 * verdict is wrong", it is "you did not do anything" — and the cure for that
 * is naming all nine checks, including the grey one we did not run.
 *
 * No accordions. A collapsed report is a report nobody reads, and the whole
 * point of this section is that it can be read.
 */

/**
 * A shape as well as a colour, on every row.
 *
 * Red and amber are the same grey to a deuteranope, and this row is the one
 * place the report says whether something is wrong. The mapping lives here
 * rather than in lib/format.ts because that file is deliberately free of JSX —
 * it is imported by both sides of the wire.
 */
const OUTCOME_ICONS: Record<CheckOutcome, ComponentType<IconProps>> = {
  pass: CheckMark,
  warn: Alert,
  fail: Close,
  info: Info,
  skipped: Dash,
};

export function CheckList({ checks }: { checks: readonly Check[] }) {
  const ran = checks.filter((check) => check.outcome !== 'skipped').length;
  const failed = checks.filter((check) => check.outcome === 'fail').length;
  const warned = checks.filter((check) => check.outcome === 'warn').length;

  return (
    <div className="px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-subtle">
          Validation report
        </p>

        <div className="flex flex-wrap items-center gap-3 text-xs tabular-nums text-ink-subtle">
          <span>
            {ran} of {checks.length} checks ran
          </span>
          {failed > 0 && (
            <span className="flex items-center gap-1 font-medium text-bad">
              <Close className="h-3 w-3" />
              {failed} failed
            </span>
          )}
          {warned > 0 && (
            <span className="flex items-center gap-1 font-medium text-warn">
              <Alert className="h-3 w-3" />
              {warned} warning{warned === 1 ? '' : 's'}
            </span>
          )}
        </div>
      </div>

      <ol className="mt-3 space-y-2">
        {checks.map((check) => (
          <CheckRow key={check.id} check={check} />
        ))}
      </ol>
    </div>
  );
}

function CheckRow({ check }: { check: Check }) {
  const style = CHECK_OUTCOME_STYLES[check.outcome];
  const Icon = OUTCOME_ICONS[check.outcome];

  return (
    <li className={`overflow-hidden rounded-lg border ${style.border}`}>
      <div className={`flex items-center gap-2.5 px-3.5 py-2 ${style.bg}`}>
        <span
          aria-hidden="true"
          className={`grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full ${style.mark}`}
        >
          <Icon className="h-2.5 w-2.5" />
        </span>
        <h4 className="min-w-0 flex-1 text-[13px] font-semibold text-ink">{check.title}</h4>
        <span
          className={`shrink-0 text-[10px] font-semibold uppercase tracking-[0.06em] ${style.text}`}
        >
          {style.label}
        </span>
      </div>

      <div className="space-y-2.5 border-t border-line/60 bg-surface px-3.5 py-2.5">
        <p className="text-[13px] leading-relaxed text-ink-muted">{check.detail}</p>

        {check.items !== undefined && check.items.length > 0 && (
          <ul className="space-y-1">
            {check.items.map((item, index) => (
              <li key={item} className="flex gap-2.5 font-mono text-xs text-ink">
                {/* Priority order is the only order these ever arrive in. */}
                <span className="shrink-0 text-ink-subtle tabular-nums">{index + 1}.</span>
                <span className="break-all">{item}</span>
              </li>
            ))}
          </ul>
        )}

        {check.facts.length > 0 && (
          <dl className="grid grid-cols-1 gap-x-6 gap-y-2 border-t border-line-subtle pt-2.5 sm:grid-cols-2">
            {check.facts.map((fact) => (
              <div key={fact.label} className="min-w-0">
                <dt className="text-[10px] font-medium uppercase tracking-wider text-ink-subtle">
                  {fact.label}
                </dt>
                <dd
                  className={`mt-0.5 break-words text-xs text-ink ${fact.mono === true ? 'font-mono' : ''}`}
                >
                  {fact.value}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </li>
  );
}
