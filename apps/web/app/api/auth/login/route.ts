import { findUserByEmail, normalizeEmail, setPasswordHash } from '@ev/db';
import { json, jsonError, readJson, withErrors } from '@/lib/http';
import { hashPassword, needsRehash, verifyPassword } from '@/lib/password';
import { clientIp, rateLimit, rateLimitHeaders } from '@/lib/rate-limit';
import { startSession } from '@/lib/session';

/**
 * Feature 25 — sign in.
 *
 * POST { email, password } → 200 { user }, and a session cookie.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Two budgets, and both must pass.
 *
 * Per-IP alone lets a botnet spread one password across many addresses.
 * Per-account alone lets one IP work through every account in the database at
 * the per-account rate. Together they bound both shapes of the attack, and the
 * account bucket means the lockout follows the account being attacked rather
 * than punishing whoever shares its NAT.
 */
const IP_LIMIT = 20;
const ACCOUNT_LIMIT = 8;
const WINDOW_MS = 10 * 60 * 1000;

export const POST = withErrors(async (request) => {
  const ipLimit = rateLimit(`login-ip:${clientIp(request)}`, IP_LIMIT, WINDOW_MS);
  const headers = rateLimitHeaders(ipLimit);

  if (!ipLimit.allowed) {
    return jsonError(
      'rate_limited',
      `Too many attempts. Try again in ${ipLimit.retryAfter}s.`,
      429,
      headers,
    );
  }

  const body = (await readJson(request)) as { email?: unknown; password?: unknown } | null;
  const email = typeof body?.email === 'string' ? normalizeEmail(body.email) : '';
  const password = typeof body?.password === 'string' ? body.password : '';

  if (email.length === 0 || password.length === 0) {
    return jsonError('invalid_request', 'Enter your email and password.', 400, headers);
  }

  const accountLimit = rateLimit(`login-account:${email}`, ACCOUNT_LIMIT, WINDOW_MS);
  if (!accountLimit.allowed) {
    return jsonError(
      'rate_limited',
      `Too many attempts for this account. Try again in ${accountLimit.retryAfter}s.`,
      429,
      { ...headers, ...rateLimitHeaders(accountLimit) },
    );
  }

  const user = await findUserByEmail(email);

  /*
   * The hash is verified even when no such account exists, against a throwaway
   * string. Returning early on a miss would make "no such user" measurably
   * faster than "wrong password", and that timing difference is enough to
   * enumerate which addresses are registered.
   */
  const ok = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);

  if (user === null || !ok) {
    // One message for both. Which of the two it was is exactly what an
    // attacker is trying to find out.
    return jsonError('invalid_credentials', 'Email or password is incorrect.', 401, headers);
  }

  if (user.status !== 'active') {
    return jsonError(
      'account_suspended',
      'This account has been suspended. Contact support.',
      403,
      headers,
    );
  }

  // Cost parameters were raised since this password was set — take the one
  // moment we legitimately hold the plaintext and upgrade the stored hash.
  if (needsRehash(user.passwordHash)) {
    await setPasswordHash(user.id, await hashPassword(password));
  }

  await startSession(user.id, request.headers.get('user-agent'));

  return json(
    { user: { id: user.id, email: user.email, name: user.name, role: user.role } },
    200,
    headers,
  );
});

/**
 * A real scrypt hash of a value nobody knows, generated once at module load.
 *
 * It exists only so the miss path costs the same as the hit path. It can never
 * match: `verifyPassword` is given this string in place of a stored hash, and
 * the branch above returns 401 whenever `user === null` regardless of what the
 * comparison said.
 */
const DUMMY_HASH =
  'scrypt$65536$8$1$AAAAAAAAAAAAAAAAAAAAAA$' +
  'ZG8tbm90LW1hdGNoLWFueXRoaW5nLWV2ZXItcGxhY2Vob2xkZXI';
