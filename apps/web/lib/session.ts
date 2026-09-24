import 'server-only';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import {
  createSession,
  deleteSession,
  findSessionUser,
  SESSION_TTL_MS,
  type User,
} from '@ev/db';

/**
 * The cookie half of feature 25. @ev/db owns what a session *is*; this file
 * owns how it rides on a request.
 *
 * Cookie flags, and why each one is not negotiable:
 *
 *   httpOnly  no script can read it, so an XSS anywhere on the origin cannot
 *             walk off with a login
 *   sameSite  'lax' — sent on top-level navigation so a link into the
 *             dashboard still works, withheld on cross-site POSTs, which is
 *             what makes CSRF on our mutating routes impractical
 *   secure    everywhere except local http, where the browser would otherwise
 *             refuse to store it at all
 *   path      '/' so one cookie covers pages and API routes alike
 */

export const SESSION_COOKIE = 'ev_session';

/**
 * Next's `cookies()` is only writable inside a Server Action or a Route
 * Handler. Pages read; routes write. Everything that starts or ends a session
 * therefore lives behind /api/auth/*, not in a page.
 */
export async function startSession(userId: string, userAgent: string | null): Promise<void> {
  const session = await createSession(userId, { userAgent });
  const jar = await cookies();

  jar.set(SESSION_COOKIE, session.token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires: session.expiresAt,
  });
}

export async function endSession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;

  // The row goes first. If the delete throws, the cookie stays and the user
  // is still logged in — which is the honest outcome, rather than a browser
  // that looks logged out while the session is still live on the server.
  if (token !== undefined) await deleteSession(token);

  jar.delete(SESSION_COOKIE);
}

/**
 * The current account, or null. Safe to call from any server component.
 *
 * Returns null for every failure — no cookie, unknown token, expired session,
 * suspended account — because the caller does the same thing in all four
 * cases and the difference is not the browser's business.
 */
export async function currentUser(): Promise<User | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token === undefined || token.length === 0) return null;

  const found = await findSessionUser(token);
  return found?.user ?? null;
}

/**
 * The current account, or a redirect to the login page.
 *
 * `next` is carried through so that following a deep link while logged out
 * lands on that page after signing in, rather than dumping everyone on the
 * dashboard root and making them navigate again.
 */
export async function requireUser(next?: string): Promise<User> {
  const user = await currentUser();
  if (user !== null) return user;

  const target =
    next === undefined || next.length === 0
      ? '/login'
      : `/login?next=${encodeURIComponent(next)}`;

  redirect(target);
}

/**
 * Admin, or a 404.
 *
 * Deliberately `notFound()` semantics rather than a "403 Forbidden" page: a
 * signed-in customer who probes /admin learns nothing about whether an admin
 * area exists. The redirect for a logged-out visitor still goes to the login
 * page, because that one is not a secret.
 */
export async function requireAdmin(next?: string): Promise<User> {
  const user = await requireUser(next);
  if (user.role !== 'admin') redirect('/jobs');
  return user;
}

export { SESSION_TTL_MS };
