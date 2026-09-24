import { createUser, EmailTakenError, normalizeEmail } from '@ev/db';
import { NAME_MAX_LENGTH, signupProblems } from '@/lib/account-input';
import { SIGNUP_CREDITS } from '@/lib/config';
import { json, jsonError, readJson, withErrors } from '@/lib/http';
import { hashPassword } from '@/lib/password';
import { clientIp, rateLimit, rateLimitHeaders } from '@/lib/rate-limit';
import { startSession } from '@/lib/session';

/**
 * Feature 25 — create an account.
 *
 * POST { email, password, name? } → 201 { user }, and a session cookie.
 *
 * Signing in immediately rather than sending a confirmation mail first: there
 * is no outbound mail in this product (see PLAN.md — sending is deliberately
 * out of scope), so an "unverified" state would be one nobody could ever leave.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Tighter than any other budget in the app: this route writes rows. */
const SIGNUP_LIMIT = 5;
const SIGNUP_WINDOW_MS = 10 * 60 * 1000;

export const POST = withErrors(async (request) => {
  const limit = rateLimit(`signup:${clientIp(request)}`, SIGNUP_LIMIT, SIGNUP_WINDOW_MS);
  const headers = rateLimitHeaders(limit);

  if (!limit.allowed) {
    return jsonError(
      'rate_limited',
      `Too many accounts from this address. Try again in ${limit.retryAfter}s.`,
      429,
      headers,
    );
  }

  const body = (await readJson(request)) as {
    email?: unknown;
    password?: unknown;
    name?: unknown;
  } | null;

  const email = typeof body?.email === 'string' ? body.email : '';
  const password = typeof body?.password === 'string' ? body.password : '';
  const name = typeof body?.name === 'string' ? body.name.trim().slice(0, NAME_MAX_LENGTH) : '';

  const problems = signupProblems({ email, password, name });
  if (problems.length > 0) {
    const first = problems[0];
    return json(
      { error: { code: 'invalid_request', message: first?.message ?? 'Check the form.' }, problems },
      400,
      headers,
    );
  }

  const passwordHash = await hashPassword(password);

  try {
    const user = await createUser({
      email,
      passwordHash,
      name: name.length > 0 ? name : null,
      signupCredits: SIGNUP_CREDITS,
    });

    await startSession(user.id, request.headers.get('user-agent'));

    return json(
      {
        user: { id: user.id, email: user.email, name: user.name, role: user.role },
        credits: user.credits,
      },
      201,
      headers,
    );
  } catch (error) {
    if (error instanceof EmailTakenError) {
      /*
       * This does disclose that an address has an account here. That is a real
       * trade and it is made deliberately: the alternative — accepting the
       * signup silently and mailing the existing owner — needs outbound mail
       * this product does not have, so it would just be a signup that appears
       * to work and never does. A stranger can learn the same fact from the
       * login form on any site that has one.
       */
      return jsonError(
        'email_taken',
        `An account already exists for ${normalizeEmail(email)}. Sign in instead.`,
        409,
        headers,
      );
    }
    throw error;
  }
});
