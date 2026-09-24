import 'server-only';

import {
  EmailValidator,
  MemoryDomainCache,
  TieredDomainCache,
  type EmailResult,
  type InspectedEmail,
} from '@ev/core';
import { PostgresDomainCache } from '@ev/db';
import { DNS_SERVERS } from './config';

/**
 * The single validator instance for this process.
 *
 * There is no validation logic here and there must never be any — every answer
 * the product gives comes out of `EmailValidator`. This file only wires the
 * engine to the platform's cache and resolver settings.
 *
 * Two cache layers (feature 22): the in-process map absorbs the repeats inside
 * one request burst, Postgres shares what every process has already learned.
 * A cold start still answers, just slower.
 *
 * ASSUMPTION — `new PostgresDomainCache()` takes no arguments and reaches the
 * shared `db` itself. Reconcile with @ev/db.
 */

let instance: EmailValidator | undefined;

export function validator(): EmailValidator {
  instance ??= new EmailValidator({
    cache: new TieredDomainCache(
      new MemoryDomainCache({ maxEntries: 20_000 }),
      new PostgresDomainCache(),
    ),
    // A person is waiting on a single check, so we fail fast rather than hold
    // the request open; a timeout is a legitimate `unknown` with a retry flag,
    // not a lost answer.
    timeout: 4000,
    tries: 2,
    servers: DNS_SERVERS,
  });

  return instance;
}

export const MAX_EMAIL_LENGTH = 320;

export type VerifyInput =
  | { ok: true; email: string }
  | { ok: false; message: string };

/** Shape check only. Whether the address is any good is core's decision. */
export function readEmailInput(body: unknown): VerifyInput {
  if (typeof body !== 'object' || body === null) {
    return { ok: false, message: 'Body must be a JSON object.' };
  }

  const email = (body as { email?: unknown }).email;
  if (typeof email !== 'string') {
    return { ok: false, message: 'Field "email" is required and must be a string.' };
  }

  const trimmed = email.trim();
  if (trimmed.length === 0) {
    return { ok: false, message: 'Field "email" must not be empty.' };
  }
  // Guards the DNS stage, not correctness — an address this long is already
  // invalid and core will say so, but we should not resolve a domain for it.
  if (trimmed.length > MAX_EMAIL_LENGTH) {
    return { ok: false, message: `Field "email" must be at most ${MAX_EMAIL_LENGTH} characters.` };
  }

  return { ok: true, email: trimmed };
}

export async function verifyAddress(email: string): Promise<EmailResult> {
  return validator().validate(email);
}

/**
 * The verdict plus the audit trail, for the dashboard's one-address view.
 *
 * The public API keeps returning a bare `EmailResult` — a caller writing rows
 * to their own database wants the verdict, not nine paragraphs per address.
 */
export async function inspectAddress(email: string): Promise<InspectedEmail> {
  return validator().inspect(email);
}
