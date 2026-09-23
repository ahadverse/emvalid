import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { and, eq, gt, lt, sql } from 'drizzle-orm';
import { getDb, type Database } from './client.ts';
import { sessions, users, type User } from './schema.ts';

/**
 * Feature 25 — server-side sessions.
 *
 * The token is 256 bits of `randomBytes`, and only its SHA-256 is stored. That
 * is the same reasoning as api-keys.ts: the token is unguessable by
 * construction, so a slow KDF would only be a self-inflicted rate limit on a
 * lookup that happens on every single request.
 *
 * A session read also returns the user, in one join. Two queries per request —
 * one for the session, one for the user — is the sort of thing that looks free
 * until every page in the dashboard does it three times.
 */

/** Long enough that a working week does not log you out. */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * `last_seen_at` is only written when it is this stale, so an idle tab
 * polling a job every two seconds does not turn a read path into a write path.
 */
const TOUCH_INTERVAL_MS = 60 * 60 * 1000;

export function generateSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export interface CreatedSession {
  id: string;
  /** The only moment this value exists outside the user's cookie jar. */
  token: string;
  expiresAt: Date;
}

export async function createSession(
  userId: string,
  { userAgent = null, ttlMs = SESSION_TTL_MS }: { userAgent?: string | null; ttlMs?: number } = {},
  db: Database = getDb(),
): Promise<CreatedSession> {
  const token = generateSessionToken();
  const expiresAt = new Date(Date.now() + ttlMs);

  const inserted = await db
    .insert(sessions)
    .values({
      userId,
      tokenHash: hashSessionToken(token),
      expiresAt,
      // Truncated: this is a diagnostic, and an unbounded header from an
      // untrusted client has no business being an unbounded column.
      userAgent: userAgent === null ? null : userAgent.slice(0, 400),
    })
    .returning({ id: sessions.id });

  const row = inserted[0];
  if (row === undefined) throw new Error('Session insert returned no row.');

  return { id: row.id, token, expiresAt };
}

export interface SessionUser {
  sessionId: string;
  user: User;
}

/**
 * Resolves a cookie value to the account it belongs to, or null.
 *
 * Null covers every failure the same way — unknown token, expired session,
 * suspended account — because the caller's response to all of them is
 * identical, and distinguishing them in the return type invites a caller to
 * leak the difference back to whoever is guessing.
 */
export async function findSessionUser(
  token: string,
  db: Database = getDb(),
): Promise<SessionUser | null> {
  if (token.length === 0) return null;

  const tokenHash = hashSessionToken(token);

  const rows = await db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, tokenHash), gt(sessions.expiresAt, new Date())))
    .limit(1);

  const row = rows[0];
  if (row === undefined) return null;

  // Defence in depth, as in lib/auth.ts: the unique index already matched, but
  // that comparison happened inside Postgres and we make no timing claims
  // about it. Re-checking puts the final yes/no on a comparison we control.
  if (!constantTimeEquals(tokenHash, row.session.tokenHash)) return null;

  // A suspended account keeps its session row — an admin may lift the
  // suspension — but it cannot act while suspended.
  if (row.user.status !== 'active') return null;

  if (Date.now() - row.session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
    // Deliberately not awaited into the response: a failed heartbeat must not
    // fail the request it was riding on.
    void db
      .update(sessions)
      .set({ lastSeenAt: new Date() })
      .where(eq(sessions.id, row.session.id))
      .catch(() => {});
  }

  return { sessionId: row.session.id, user: row.user };
}

export async function deleteSession(token: string, db: Database = getDb()): Promise<void> {
  await db.delete(sessions).where(eq(sessions.tokenHash, hashSessionToken(token)));
}

/** "Log out everywhere" — and what a password change must call. */
export async function deleteUserSessions(
  userId: string,
  db: Database = getDb(),
): Promise<number> {
  const deleted = await db
    .delete(sessions)
    .where(eq(sessions.userId, userId))
    .returning({ id: sessions.id });

  return deleted.length;
}

/** Housekeeping for the retention sweep — expired rows are dead weight. */
export async function purgeExpiredSessions(db: Database = getDb()): Promise<number> {
  const deleted = await db
    .delete(sessions)
    .where(lt(sessions.expiresAt, new Date()))
    .returning({ id: sessions.id });

  return deleted.length;
}

export async function countActiveSessions(
  userId: string,
  db: Database = getDb(),
): Promise<number> {
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(sessions)
    .where(and(eq(sessions.userId, userId), gt(sessions.expiresAt, new Date())));

  return rows[0]?.n ?? 0;
}

function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
