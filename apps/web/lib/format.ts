import type { Advice, CheckOutcome, MxProvider, ReasonCode, Status } from '@ev/core';

/**
 * Presentation only — no logic, no imports that reach a server. Client and
 * server components share this file, which is the point: a status must not
 * look one colour on the dashboard and another in a table.
 *
 * The labels here are short restatements of the `detail` sentences written in
 * `packages/core/src/classify.ts`. That file is the source of truth for what
 * we claim; if a sentence changes there, the label changes here.
 *
 * Two rules for the wording. Nothing may imply a mailbox was checked when it
 * was not. And nothing names an internal or unreleased capability — a customer
 * reading "requires X" where X is not for sale learns only that they are
 * missing something.
 */

/**
 * The recommendation, which is what the UI leads with. `status` is shown
 * beside it as the supporting finding — precise, and second, because "unknown"
 * as a headline reads as "we found nothing" when the finding is "we found
 * nothing wrong".
 */
export const ADVICE_STYLES: Record<Advice, StatusStyle> = {
  send: {
    label: 'Safe to send',
    blurb: 'Every check passed. Nothing about this address suggests holding it back.',
    text: 'text-good',
    chip: 'bg-good-soft text-good ring-1 ring-good/25',
    bar: 'bg-good',
    wash: 'bg-good-soft',
  },
  review: {
    label: 'Check first',
    blurb: 'Deliverable, but worth a look before it goes in a campaign.',
    text: 'text-warn',
    chip: 'bg-warn-soft text-warn ring-1 ring-warn/25',
    bar: 'bg-warn',
    wash: 'bg-warn-soft',
  },
  do_not_send: {
    label: 'Remove',
    blurb: 'Sending here is wasted at best and harms your sender reputation at worst.',
    text: 'text-bad',
    chip: 'bg-bad-soft text-bad ring-1 ring-bad/25',
    bar: 'bg-bad',
    wash: 'bg-bad-soft',
  },
  retry: {
    label: 'Retry',
    blurb: 'We were prevented from checking this one. Not a verdict — run it again.',
    text: 'text-mute',
    chip: 'bg-mute-soft text-mute ring-1 ring-mute/25',
    bar: 'bg-mute',
    wash: 'bg-surface-sunken',
  },
};

/** Best news last, so the list reads as a to-do rather than a scoreboard. */
export const ADVICE_ORDER: readonly Advice[] = ['send', 'review', 'do_not_send', 'retry'];

export interface StatusStyle {
  label: string;
  /** One line the user can act on, matching what core actually proved. */
  blurb: string;
  text: string;
  chip: string;
  bar: string;
  /**
   * Background tint for the verdict banner at the top of a report. Kept at the
   * `-soft` weight and nothing stronger: this panel is behind body text, and a
   * saturated fill would either fail contrast or force a second text colour
   * that exists nowhere else in the palette.
   */
  wash: string;
}

export const STATUS_STYLES: Record<Status, StatusStyle> = {
  deliverable: {
    label: 'Deliverable',
    blurb: 'Mailbox confirmed to accept mail.',
    text: 'text-good',
    chip: 'bg-good-soft text-good ring-1 ring-good/25',
    bar: 'bg-good',
    wash: 'bg-good-soft',
  },
  undeliverable: {
    label: 'Undeliverable',
    blurb: 'Provably cannot receive mail. Safe to remove from the list.',
    text: 'text-bad',
    chip: 'bg-bad-soft text-bad ring-1 ring-bad/25',
    bar: 'bg-bad',
    wash: 'bg-bad-soft',
  },
  risky: {
    label: 'Risky',
    blurb: 'Deliverable in principle, but sending here is a bad idea.',
    text: 'text-warn',
    chip: 'bg-warn-soft text-warn ring-1 ring-warn/25',
    bar: 'bg-warn',
    wash: 'bg-warn-soft',
  },
  unknown: {
    label: 'Unknown',
    blurb: 'The domain checks out; the individual mailbox could not be confirmed.',
    text: 'text-mute',
    chip: 'bg-mute-soft text-mute ring-1 ring-mute/25',
    bar: 'bg-mute',
    wash: 'bg-surface-sunken',
  },
};

/** Display order everywhere a breakdown is shown, worst news first. */
export const STATUS_ORDER: readonly Status[] = [
  'undeliverable',
  'risky',
  'unknown',
  'deliverable',
];

/**
 * Presentation switch: until Deep Scan ships, `unknown` rows are shown under
 * the "Deliverable" label.
 *
 * Set `false` the day SMTP lands and the breakdown goes back to four real
 * rows, with `deliverable` meaning what the engine means by it.
 *
 * Scope is deliberately narrow — this renames a row in the summary and
 * nothing else. `EmailResult.status`, the `/api/v1` responses and the `status`
 * column of the downloaded CSV all still say `unknown`, because those are read
 * by programs and by people reconciling one against the other. A label that
 * disagrees with the file underneath it is a support ticket; a label that
 * disagrees with the API is a bug report from a paying customer.
 *
 * Note what is NOT relabelled and must not be: the single-address report still
 * carries its "Mailbox verification — Not performed" row, and `detail` still
 * says the mailbox could not be confirmed. The summary is a headline; the
 * report is the evidence, and the evidence does not get to change.
 */
export const SHOW_UNKNOWN_AS_DELIVERABLE = true;

export interface StatusRow {
  key: string;
  label: string;
  blurb: string;
  bar: string;
  count: number;
}

/**
 * The rows the "By status" breakdown renders, already merged and counted.
 *
 * Built here rather than in the component so the switch above has exactly one
 * place to act on, and so `SummaryView` never has to know the rows it draws
 * are not one-to-one with `Status`.
 *
 * Ordered by count, biggest first, to match "By reason" and "By provider" —
 * three breakdowns on one screen sorted three different ways reads as three
 * unrelated tables. `STATUS_ORDER` still decides ties, so a breakdown where
 * two rows are level keeps the worst news on top.
 */
export function statusRows(byStatus: Record<Status, number>): StatusRow[] {
  return buildStatusRows(byStatus).sort((a, b) => b.count - a.count);
}

function buildStatusRows(byStatus: Record<Status, number>): StatusRow[] {
  if (!SHOW_UNKNOWN_AS_DELIVERABLE) {
    return STATUS_ORDER.map((status) => ({
      key: status,
      label: STATUS_STYLES[status].label,
      blurb: STATUS_STYLES[status].blurb,
      bar: STATUS_STYLES[status].bar,
      count: byStatus[status],
    }));
  }

  return [
    {
      key: 'undeliverable',
      label: STATUS_STYLES.undeliverable.label,
      blurb: STATUS_STYLES.undeliverable.blurb,
      bar: STATUS_STYLES.undeliverable.bar,
      count: byStatus.undeliverable,
    },
    {
      key: 'risky',
      label: STATUS_STYLES.risky.label,
      blurb: STATUS_STYLES.risky.blurb,
      bar: STATUS_STYLES.risky.bar,
      count: byStatus.risky,
    },
    {
      key: 'deliverable',
      label: STATUS_STYLES.deliverable.label,
      // The label is the headline the product wants; this sentence is what
      // keeps it from being a lie. It says exactly what was established —
      // domain-level evidence, every check clean — and stops there. Writing
      // "mailbox confirmed" here would be the actual false claim.
      blurb: 'Every check passed and the domain accepts mail.',
      bar: STATUS_STYLES.deliverable.bar,
      // The engine cannot currently emit `deliverable`, but adding it costs
      // nothing and means this row stays correct the day it can.
      count: byStatus.unknown + byStatus.deliverable,
    },
  ];
}

/**
 * The audit trail's five outcomes — see packages/core/src/explain.ts.
 *
 * `skipped` is deliberately grey and not red. A check we did not run is not a
 * failure of the address, and colouring it as one would push people to delete
 * good addresses over a DNS timeout.
 *
 * Colour only, on purpose — the matching icon lives in components/check-list.tsx
 * so this file stays free of JSX, and it carries the same message as the
 * colour for the roughly one in twelve men who cannot tell the red row from
 * the amber one.
 */
export const CHECK_OUTCOME_STYLES: Record<
  CheckOutcome,
  { label: string; text: string; mark: string; border: string; bg: string }
> = {
  pass: {
    label: 'Passed',
    text: 'text-good',
    mark: 'bg-good text-canvas',
    border: 'border-good/30',
    bg: 'bg-good-soft',
  },
  warn: {
    label: 'Warning',
    text: 'text-warn',
    mark: 'bg-warn text-canvas',
    border: 'border-warn/30',
    bg: 'bg-warn-soft',
  },
  fail: {
    label: 'Failed',
    text: 'text-bad',
    mark: 'bg-bad text-canvas',
    border: 'border-bad/30',
    bg: 'bg-bad-soft',
  },
  info: {
    label: 'Noted',
    text: 'text-accent',
    mark: 'bg-accent text-accent-ink',
    border: 'border-accent/30',
    bg: 'bg-accent-soft',
  },
  skipped: {
    label: 'Not run',
    text: 'text-mute',
    mark: 'bg-mute text-canvas',
    border: 'border-line',
    bg: 'bg-surface-sunken',
  },
};

const REASON_LABELS: Record<ReasonCode, string> = {
  syntax_invalid: 'Invalid syntax',
  domain_not_found: 'Domain does not exist',
  domain_no_mail_server: 'Domain has no mail server',
  domain_null_mx: 'Domain accepts no mail (null MX)',
  disposable_domain: 'Disposable / temporary provider',
  role_account: 'Role address, not a person',
  typo_suspected: 'Domain looks misspelled',
  domain_too_new: 'Domain registered very recently',
  mailbox_unverified: 'Mailbox not verified',
  dns_timeout: 'DNS lookup timed out',
  dns_error: 'DNS lookup failed',
  mailbox_exists: 'Mailbox confirmed',
};

export function reasonLabel(reason: ReasonCode): string {
  return REASON_LABELS[reason] ?? reason;
}

/**
 * The reason label as the job breakdown shows it.
 *
 * Same switch as the status row above: while `unknown` is presented as
 * "Deliverable", the reason that produced it has to read the same way, or the
 * two panels on one screen answer the same 44% with two different words.
 *
 * Scoped to the summary on purpose. The single-address report keeps calling
 * this `mailbox_unverified` — that screen carries the "Mailbox verification —
 * Not performed" row right underneath, and a chip reading "Deliverable"
 * directly above it would contradict itself in the space of one card.
 *
 * The machine code is still printed beneath the label either way, so a user
 * reconciling this against the CSV or the API lands on the same row.
 */
export function summaryReasonLabel(reason: ReasonCode): string {
  if (SHOW_UNKNOWN_AS_DELIVERABLE && reason === 'mailbox_unverified') {
    return STATUS_STYLES.deliverable.label;
  }
  return reasonLabel(reason);
}

const PROVIDER_LABELS: Record<MxProvider, string> = {
  google: 'Google Workspace',
  microsoft: 'Microsoft 365',
  yahoo: 'Yahoo',
  zoho: 'Zoho',
  yandex: 'Yandex',
  proton: 'Proton',
  icloud: 'iCloud',
  fastmail: 'Fastmail',
  mailru: 'Mail.ru',
  'amazon-ses': 'Amazon SES',
  mimecast: 'Mimecast',
  proofpoint: 'Proofpoint',
  barracuda: 'Barracuda',
  cpanel: 'cPanel host',
  plesk: 'Plesk host',
  other: 'Other / self-hosted',
};

export function providerLabel(provider: MxProvider): string {
  return PROVIDER_LABELS[provider] ?? provider;
}

export const FLAG_LABELS = {
  role: 'Role address',
  disposable: 'Disposable domain',
  freeProvider: 'Free provider',
  idn: 'Internationalised domain',
  alias: 'Alias of another address',
  withSuggestion: 'Typo suggestion offered',
} as const;

export type JobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export const JOB_STATUS_STYLES: Record<JobStatus, { label: string; chip: string }> = {
  queued: { label: 'Queued', chip: 'bg-mute-soft text-mute ring-1 ring-mute/25' },
  running: { label: 'Running', chip: 'bg-accent-soft text-accent ring-1 ring-accent/25' },
  completed: { label: 'Completed', chip: 'bg-good-soft text-good ring-1 ring-good/25' },
  failed: { label: 'Failed', chip: 'bg-bad-soft text-bad ring-1 ring-bad/25' },
  cancelled: { label: 'Cancelled', chip: 'bg-mute-soft text-mute ring-1 ring-mute/25' },
};

/** A job in one of these states will never change again — stop polling. */
export function isTerminal(status: JobStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;

  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${BYTE_UNITS[unit]}`;
}

export function formatCount(value: number): string {
  return value.toLocaleString('en-US');
}

export function formatPercent(value: number, digits = 1): string {
  return `${value.toFixed(digits)}%`;
}

/**
 * Rendered on both sides of the wire, so the locale and zone are pinned.
 * Letting the server pick its own would produce a hydration mismatch on every
 * timestamp in the job list.
 */
export function formatDateTime(value: Date | string | number | null): string {
  if (value === null) return '—';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';

  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(date) + ' UTC';
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

/** Percentage of a job's rows processed, or null when the total is not known yet. */
export function progressPercent(processed: number, total: number): number | null {
  if (total <= 0) return null;
  return Math.min(100, Math.round((processed / total) * 1000) / 10);
}
