import type { Advice, EmailResult, MxProvider, ReasonCode, Status } from './types.ts';

/**
 * Feature 18 — the breakdown a user sees when a job finishes.
 *
 * Accumulated one result at a time and never holding the results themselves,
 * because on a ten-million-row job there is no array to reduce over — rows
 * stream to disk and only these counters survive.
 */

export interface JobSummary {
  total: number;
  duplicates: number;
  /**
   * The breakdown a user reads first: how many to keep, check, and drop.
   * `byStatus` is the same rows sliced by what we proved rather than by what
   * to do about it.
   */
  byAdvice: Record<Advice, number>;
  byStatus: Record<Status, number>;
  byReason: Partial<Record<ReasonCode, number>>;
  byProvider: Partial<Record<MxProvider, number>>;
  flags: {
    role: number;
    disposable: number;
    freeProvider: number;
    idn: number;
    alias: number;
    withSuggestion: number;
  };
  /** Rows whose DNS failed and that a retry pass still owes an answer for. */
  retryable: number;
  /**
   * Share of rows we gave a firm answer on — undeliverable plus risky.
   * The number to watch: without SMTP it settles around 25%, and saying so
   * up front is the difference between an honest tool and a dishonest one.
   */
  coverage: number;
}

export class SummaryBuilder {
  readonly #summary: JobSummary = {
    total: 0,
    duplicates: 0,
    byAdvice: { send: 0, review: 0, do_not_send: 0, retry: 0 },
    byStatus: { deliverable: 0, undeliverable: 0, risky: 0, unknown: 0 },
    byReason: {},
    byProvider: {},
    flags: { role: 0, disposable: 0, freeProvider: 0, idn: 0, alias: 0, withSuggestion: 0 },
    retryable: 0,
    coverage: 0,
  };

  add(result: EmailResult): void {
    const s = this.#summary;
    s.total++;
    s.byAdvice[result.advice]++;
    s.byStatus[result.status]++;
    s.byReason[result.reason] = (s.byReason[result.reason] ?? 0) + 1;

    if (result.flags.mxProvider !== null) {
      s.byProvider[result.flags.mxProvider] = (s.byProvider[result.flags.mxProvider] ?? 0) + 1;
    }

    if (result.flags.role) s.flags.role++;
    if (result.flags.disposable) s.flags.disposable++;
    if (result.flags.freeProvider) s.flags.freeProvider++;
    if (result.flags.idn) s.flags.idn++;
    if (result.flags.alias) s.flags.alias++;
    if (result.suggestion !== null) s.flags.withSuggestion++;
    if (result.retryable) s.retryable++;
  }

  addDuplicate(): void {
    this.#summary.duplicates++;
  }

  build(): JobSummary {
    const s = this.#summary;
    const answered = s.byStatus.deliverable + s.byStatus.undeliverable + s.byStatus.risky;
    return {
      ...s,
      byAdvice: { ...s.byAdvice },
      byStatus: { ...s.byStatus },
      byReason: { ...s.byReason },
      byProvider: { ...s.byProvider },
      flags: { ...s.flags },
      coverage: s.total === 0 ? 0 : Math.round((answered / s.total) * 1000) / 10,
    };
  }
}
