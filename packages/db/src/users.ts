import { asc, desc, eq, ilike, or, sql } from 'drizzle-orm';
import { getDb, type Database } from './client.ts';
import { creditLedger, jobs, orders, users, type User, type UserRole, type UserStatus } from './schema.ts';

/**
 * Feature 25 — accounts.
 *
 * Password hashing is *not* here. It needs a slow KDF and a policy about cost
 * parameters, both of which belong with the code that handles the plaintext —
 * which is the web app, and only ever for the duration of one request. This
 * module stores whatever string it is handed and compares nothing.
 *
 * Every lookup by email goes through `normalizeEmail`. Postgres compares text
 * case-sensitively, so without it "Ahad@x.com" and "ahad@x.com" are two
 * accounts with one unique index between them — which shows up as a confusing
 * "email already taken" on a login that then fails.
 */

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export interface CreateUserInput {
  email: string;
  passwordHash: string;
  name?: string | null;
  role?: UserRole;
  /** Granted on creation and written to the ledger. 0 grants nothing. */
  signupCredits?: number;
}

/**
 * Thrown rather than returned: a duplicate email is the one failure the caller
 * always has to handle differently, and an `ok: false` union tempts a caller
 * into treating it as a generic error and showing "something went wrong" for
 * the most common signup mistake there is.
 */
export class EmailTakenError extends Error {
  constructor(readonly email: string) {
    super(`An account already exists for ${email}.`);
    this.name = 'EmailTakenError';
  }
}

export async function createUser(
  input: CreateUserInput,
  db: Database = getDb(),
): Promise<User> {
  const email = normalizeEmail(input.email);
  const grant = Math.max(0, Math.trunc(input.signupCredits ?? 0));

  return db.transaction(async (tx) => {
    // A pre-check would still race two simultaneous signups; the unique index
    // is the only thing that actually decides, so the insert is what we catch.
    const inserted = await tx
      .insert(users)
      .values({
        email,
        passwordHash: input.passwordHash,
        name: input.name ?? null,
        role: input.role ?? 'user',
        credits: grant,
      })
      .onConflictDoNothing({ target: users.email })
      .returning();

    const user = inserted[0];
    if (user === undefined) throw new EmailTakenError(email);

    if (grant > 0) {
      await tx.insert(creditLedger).values({
        userId: user.id,
        delta: grant,
        balanceAfter: grant,
        reason: 'signup_grant',
        note: 'Trial credits granted at signup',
      });
    }

    return user;
  });
}

export async function findUserByEmail(
  email: string,
  db: Database = getDb(),
): Promise<User | null> {
  const rows = await db
    .select()
    .from(users)
    .where(eq(users.email, normalizeEmail(email)))
    .limit(1);

  return rows[0] ?? null;
}

export async function findUserById(id: string, db: Database = getDb()): Promise<User | null> {
  const rows = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function setPasswordHash(
  userId: string,
  passwordHash: string,
  db: Database = getDb(),
): Promise<void> {
  await db
    .update(users)
    .set({ passwordHash, updatedAt: new Date() })
    .where(eq(users.id, userId));
}

export async function setUserRole(
  userId: string,
  role: UserRole,
  db: Database = getDb(),
): Promise<void> {
  await db.update(users).set({ role, updatedAt: new Date() }).where(eq(users.id, userId));
}

export async function setUserStatus(
  userId: string,
  status: UserStatus,
  db: Database = getDb(),
): Promise<void> {
  await db.update(users).set({ status, updatedAt: new Date() }).where(eq(users.id, userId));
}

/**
 * Guards the last way back in.
 *
 * An admin suspending or demoting the only remaining admin locks every human
 * out of the admin area permanently — the fix then needs a psql prompt. Callers
 * check this first; it is cheap and it is checked inside the same request that
 * would do the damage.
 */
export async function countActiveAdmins(db: Database = getDb()): Promise<number> {
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(users)
    .where(sql`${users.role} = 'admin' AND ${users.status} = 'active'`);

  return rows[0]?.n ?? 0;
}

export interface AdminUserRow {
  id: string;
  email: string;
  name: string | null;
  role: UserRole;
  status: UserStatus;
  credits: number;
  createdAt: Date;
  jobCount: number;
  paidTaka: number;
}

/**
 * The admin user table, with the two numbers an operator always asks for next
 * — how much have they run, how much have they paid — joined in rather than
 * fetched per row. A list of fifty users is otherwise a hundred and one
 * queries.
 */
export async function listUsersForAdmin(
  { search = '', limit = 100 }: { search?: string; limit?: number } = {},
  db: Database = getDb(),
): Promise<AdminUserRow[]> {
  const term = search.trim();

  const jobCounts = db
    .select({ userId: jobs.userId, n: sql<number>`count(*)::int`.as('n') })
    .from(jobs)
    .groupBy(jobs.userId)
    .as('job_counts');

  const paid = db
    .select({
      userId: orders.userId,
      taka: sql<number>`coalesce(sum(${orders.amountTaka}), 0)::int`.as('taka'),
    })
    .from(orders)
    .where(eq(orders.status, 'paid'))
    .groupBy(orders.userId)
    .as('paid_orders');

  const query = db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      status: users.status,
      credits: users.credits,
      createdAt: users.createdAt,
      jobCount: sql<number>`coalesce(${jobCounts.n}, 0)::int`,
      paidTaka: sql<number>`coalesce(${paid.taka}, 0)::int`,
    })
    .from(users)
    .leftJoin(jobCounts, eq(jobCounts.userId, users.id))
    .leftJoin(paid, eq(paid.userId, users.id))
    .$dynamic();

  if (term.length > 0) {
    query.where(or(ilike(users.email, `%${term}%`), ilike(users.name, `%${term}%`)));
  }

  return query.orderBy(desc(users.createdAt)).limit(Math.min(500, Math.max(1, limit)));
}

export interface PlatformStats {
  users: number;
  activeUsers: number;
  admins: number;
  jobs: number;
  pendingOrders: number;
  paidOrders: number;
  revenueTaka: number;
  creditsOutstanding: number;
}

/** The admin dashboard's header row, in one round trip. */
export async function platformStats(db: Database = getDb()): Promise<PlatformStats> {
  const [userRow] = await db
    .select({
      users: sql<number>`count(*)::int`,
      activeUsers: sql<number>`count(*) filter (where ${users.status} = 'active')::int`,
      admins: sql<number>`count(*) filter (where ${users.role} = 'admin')::int`,
      creditsOutstanding: sql<number>`coalesce(sum(${users.credits}), 0)::int`,
    })
    .from(users);

  const [jobRow] = await db.select({ jobs: sql<number>`count(*)::int` }).from(jobs);

  const [orderRow] = await db
    .select({
      pendingOrders: sql<number>`count(*) filter (where ${orders.status} = 'pending')::int`,
      paidOrders: sql<number>`count(*) filter (where ${orders.status} = 'paid')::int`,
      revenueTaka: sql<number>`coalesce(sum(${orders.amountTaka}) filter (where ${orders.status} = 'paid'), 0)::int`,
    })
    .from(orders);

  return {
    users: userRow?.users ?? 0,
    activeUsers: userRow?.activeUsers ?? 0,
    admins: userRow?.admins ?? 0,
    creditsOutstanding: userRow?.creditsOutstanding ?? 0,
    jobs: jobRow?.jobs ?? 0,
    pendingOrders: orderRow?.pendingOrders ?? 0,
    paidOrders: orderRow?.paidOrders ?? 0,
    revenueTaka: orderRow?.revenueTaka ?? 0,
  };
}

/** Oldest first — used by the seeding CLI to find the account to promote. */
export async function firstUser(db: Database = getDb()): Promise<User | null> {
  const rows = await db.select().from(users).orderBy(asc(users.createdAt)).limit(1);
  return rows[0] ?? null;
}
