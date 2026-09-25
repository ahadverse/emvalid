import 'server-only';

import {
  InsufficientCreditError,
  RequestThrottledError,
  ServiceUnreachableError,
  VerifaliaRestClient,
} from 'verifalia';
import type { EmailResult } from '@ev/core';
import { VERIFALIA_USERNAME, VERIFALIA_PASSWORD } from './config';

/**
 * Hybrid SMTP fallback — real mailbox verification borrowed from Verifalia
 * instead of self-hosted (PLAN.md's "Deep Scan" stays pending; this is the
 * "Hybrid — paid API fallback" row instead).
 *
 * Deliberately not automatic. Verifalia's free tier is a handful of checks a
 * day; wiring this into every `/api/verify` call would burn the whole daily
 * allowance on the first few visitors, or bot traffic, rather than the
 * person who actually asked for a definitive answer. `deepScan` is only ever
 * called from a dedicated route the UI reaches through its own button — see
 * `app/api/verify/deep-scan/route.ts`.
 *
 * Every failure mode here — no credentials, no credit left, the API
 * throttled or unreachable, a timeout — returns the caller's own result
 * unchanged rather than throwing or guessing. A live SMTP conversation is
 * the least reliable check in this whole product; it must never be allowed
 * to look more certain than it is by crashing into a worse answer.
 */

const TIMEOUT_MS = 20_000;

let client: VerifaliaRestClient | null | undefined;

/**
 * Constructed once, lazily, from whatever `config.ts` read from the
 * environment. `undefined` means "not decided yet" and `null` means
 * "decided: not configured" — the two must stay distinguishable, or a
 * missing credential on the first call would be retried forever.
 */
function getClient(): VerifaliaRestClient | null {
  if (client !== undefined) return client;

  client =
    VERIFALIA_USERNAME === null || VERIFALIA_PASSWORD === null
      ? null
      : new VerifaliaRestClient({ username: VERIFALIA_USERNAME, password: VERIFALIA_PASSWORD });

  return client;
}

/** Whether the UI should offer the deep-scan button at all. */
export function deepScanAvailable(): boolean {
  return getClient() !== null;
}

/**
 * Only worth calling on a result the engine itself could not resolve.
 * Calling it on a certain verdict would spend a scarce, possibly billed
 * check to confirm something already known for free.
 */
export async function deepScan(result: EmailResult): Promise<EmailResult> {
  const verifalia = getClient();
  // A certain verdict — undeliverable, risky, or a syntax failure — is not
  // made any more certain by an SMTP conversation, and spending one of a
  // handful of daily checks to confirm something already known for free
  // defeats the entire point of gating this behind a button.
  if (verifalia === null || result.normalized === null || result.status !== 'unknown') return result;

  try {
    const submission = await withTimeout(
      verifalia.emailValidations.submit(result.normalized),
      TIMEOUT_MS,
    );
    const entry = submission?.entries?.[0];
    if (entry === undefined) return result;

    return applyEntry(result, entry.classification, entry.status);
  } catch (error) {
    if (
      error instanceof InsufficientCreditError ||
      error instanceof RequestThrottledError ||
      error instanceof ServiceUnreachableError ||
      (error instanceof Error && error.message === 'verifalia_timeout')
    ) {
      return result;
    }
    // Anything else is a real bug in this integration, not an expected
    // degradation — it belongs in the logs, not swallowed into a false
    // "we tried and learned nothing".
    throw error;
  }
}

/**
 * The SDK types both fields as optional (`string | undefined`) even though
 * a completed entry always carries them — string literals rather than the
 * SDK's own `ValidationEntryClassification_*` constants, which the package
 * exports from its runtime but not from its own type declarations.
 */
function applyEntry(
  result: EmailResult,
  classification: string | undefined,
  status: string | undefined,
): EmailResult {
  if (classification === 'Deliverable') {
    return {
      ...result,
      status: 'deliverable',
      advice: 'send',
      confidence: 99,
      reason: 'mailbox_exists',
      detail: 'Confirmed by a live SMTP check: the mailbox exists and accepts mail.',
      retryable: false,
    };
  }

  if (classification === 'Undeliverable') {
    return {
      ...result,
      status: 'undeliverable',
      advice: 'do_not_send',
      confidence: 97,
      reason: 'mailbox_not_found',
      detail: 'Confirmed by a live SMTP check: the mail server rejected this address — the mailbox does not exist.',
      retryable: false,
    };
  }

  // Verifalia's own 'Risky' and 'Unknown' classifications are not a more
  // certain answer than the one already returned — a catch-all domain or a
  // temporarily unavailable mailbox does not become "confirmed" either way.
  // Say what was actually observed rather than silently doing nothing: a
  // person who asked for a definitive answer deserves to know one was not
  // reached, not the same sentence twice.
  return {
    ...result,
    detail: `${result.detail} A live SMTP check did not go further than this (${humanStatus(status)}).`,
  };
}

/** Verifalia's status names are already words, just PascalCased — split them. */
function humanStatus(status: string | undefined): string {
  if (status === undefined) return 'no further detail from the API';
  return status.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('verifalia_timeout')), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
