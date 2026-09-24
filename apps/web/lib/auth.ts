import 'server-only';

import { timingSafeEqual } from 'node:crypto';
import { hashApiKey, verifyApiKey } from '@ev/db';

/**
 * Feature 20 — API key authentication for the public API.
 *
 * The key material never leaves @ev/db: it owns generation, the SHA-256 and the
 * lookup, so there is exactly one definition of what a valid key is. This file
 * is only the HTTP half — pulling the bearer token out of the request and
 * turning a miss into an error a caller can act on.
 *
 * Nothing in here logs, returns or throws a raw key.
 */

export interface ApiKeyIdentity {
  keyId: string;
  userId: string;
  /** `ev_live_xxxxxxxx` — safe to show and to log. */
  prefix: string;
}

export type AuthFailure = 'missing_authorization' | 'malformed_authorization' | 'invalid_key';

export type AuthResult =
  | { ok: true; identity: ApiKeyIdentity }
  | { ok: false; reason: AuthFailure; message: string };

const FAILURE_MESSAGES: Record<AuthFailure, string> = {
  missing_authorization: 'Missing Authorization header. Use: Authorization: Bearer <api key>.',
  malformed_authorization: 'Authorization header must be of the form: Bearer <api key>.',
  // Revoked and unknown deliberately give the same answer: @ev/db's lookup
  // excludes revoked rows, and telling a caller which of the two it hit would
  // confirm that a key they hold once existed.
  invalid_key: 'API key not recognised, or revoked.',
};

function fail(reason: AuthFailure): AuthResult {
  return { ok: false, reason, message: FAILURE_MESSAGES[reason] };
}

export function bearerToken(request: Request): string | null {
  const header = request.headers.get('authorization');
  if (header === null) return null;

  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match?.[1] ?? null;
}

/** What a user sees for a key they can no longer read in full. */
export function maskedKey(prefix: string): string {
  return `${prefix}…`;
}

export async function authenticate(request: Request): Promise<AuthResult> {
  if (request.headers.get('authorization') === null) return fail('missing_authorization');

  const raw = bearerToken(request);
  if (raw === null || raw.length === 0) return fail('malformed_authorization');

  // Also records lastUsedAt, throttled to one write per key per minute.
  const record = await verifyApiKey(raw);
  if (record === null) return fail('invalid_key');

  // Defence in depth. The lookup already matched on a unique index, but that
  // comparison happened inside Postgres and we make no claims about its
  // timing; re-checking here puts the final yes/no on a comparison we control,
  // and costs a few microseconds on a path that already did a round trip.
  if (!constantTimeEquals(hashApiKey(raw), record.keyHash)) return fail('invalid_key');

  return {
    ok: true,
    identity: { keyId: record.id, userId: record.userId, prefix: record.prefix },
  };
}

function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  // timingSafeEqual throws on a length mismatch, which would itself leak the
  // length. Hashes are fixed width, so unequal length is already a mismatch.
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
