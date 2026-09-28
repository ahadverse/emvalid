import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * The local driver's stand-in for S3's presigned URLs.
 *
 * S3 hands a client a URL that is its own authorisation, expiring on its own.
 * The local driver has to hand out something with the same properties, or the
 * browser would need two upload paths — a signed PUT against the bucket in
 * production and a multipart POST in development — and the one that only runs
 * on a laptop is the one that silently rots.
 *
 * So: same flow, same code in the upload form, a route handler instead of a
 * bucket. The link is scoped to one key and one verb, because a link that let
 * a client PUT anywhere would be worse than no development parity at all.
 */

export type SignedAction = 'put' | 'get';

/** Seconds since the epoch, not milliseconds — it travels in a URL. */
export function signLink(
  secret: string,
  action: SignedAction,
  key: string,
  expiresAt: number,
): string {
  return createHmac('sha256', secret).update(`${action}\n${key}\n${expiresAt}`).digest('base64url');
}

export function verifyLink(
  secret: string,
  action: SignedAction,
  key: string,
  expiresAt: number,
  signature: string,
  now: number = Date.now(),
): boolean {
  if (!Number.isFinite(expiresAt) || expiresAt * 1000 <= now) return false;

  const expected = Buffer.from(signLink(secret, action, key, expiresAt), 'utf8');
  const given = Buffer.from(signature, 'utf8');

  // Length is compared first because timingSafeEqual throws on a mismatch, and
  // the length of a base64url HMAC is fixed and public anyway.
  return expected.length === given.length && timingSafeEqual(expected, given);
}
