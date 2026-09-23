import { desc, eq, sql } from 'drizzle-orm';
import { getDb, type Database } from './client.ts';
import { creditLedger, users, type CreditLedgerRow, type CreditReason } from './schema.ts';

/**
 * Feature 26/27 — credits, and the ledger that explains every one of them.
 *
 * One verification costs one credit. Two rules hold the whole thing together:
 *
 *   1. `users.credits` is only ever changed by a function in this file.
 *   2. Every change writes a ledger row in the same transaction.
 *
 * Break either and the balance becomes a number nobody can account for, which
 * on a paid product is the difference between a support reply and a refund.
 *
 * Balances go through `UPDATE ... SET credits = credits - n RETURNING`, not a
 * read-modify-write. A worker deducting per chunk while the dashboard grants a
 * purchase is two concurrent writers on one row, and read-modify-write silently
 * loses one of them.
 */

export class InsufficientCreditsError extends Error {
  constructor(
    readonly required: number,
    readonly available: number,
  ) {
    super(`Not enough credits: ${required} needed, ${available} available.`);
    this.name = 'InsufficientCreditsError';
  }
}

export interface GrantOptions {
  reason: Extract<CreditReason, 'signup_grant' | 'purchase' | 'refund' | 'admin_adjustment'>;
  orderId?: string | null;
  note?: string | null;
}

/**
 * Adds credits. Returns the new balance.
 *
 * `amount` must be positive — a "grant" of a negative number is a deduction
 * that skips the balance check, which is exactly the bug this split exists to
 * prevent.
 */
export async function grantCredits(
  userId: string,
  amount: number,
  options: GrantOptions,
  db: Database = getDb(),
): Promise<number> {
  const delta = Math.trunc(amount);
  if (delta <= 0) throw new RangeError('grantCredits requires a positive amount.');

  return db.transaction(async (tx) => {
    const updated = await tx
      .update(users)
      .set({ credits: sql`${users.credits} + ${delta}`, updatedAt: new Date() })
      .where(eq(users.id, userId))
      .returning({ credits: users.credits });

    const balance = updated[0]?.credits;
    if (balance === undefined) throw new Error(`No such user: ${userId}`);

    await tx.insert(creditLedger).values({
      userId,
      delta,
      balanceAfter: balance,
      reason: options.reason,
      orderId: options.orderId ?? null,
      note: options.note ?? null,
    });

    return balance;
  });
}

/**
 * Spends credits, refusing to go below zero. Returns the new balance.
 *
 * The `WHERE credits >= n` is the whole safety property: two workers charging
 * the same account at the same instant cannot both pass it, because the second
 * one's UPDATE matches no row and returns nothing.
 */
export async function consumeCredits(
  userId: string,
  amount: number,
  { jobId = null, note = null }: { jobId?: string | null; note?: string | null } = {},
  db: Database = getDb(),
): Promise<number> {
  const delta = Math.trunc(amount);
  if (delta <= 0) throw new RangeError('consumeCredits requires a positive amount.');

  return db.transaction(async (tx) => {
    const updated = await tx
      .update(users)
      .set({ credits: sql`${users.credits} - ${delta}`, updatedAt: new Date() })
      .where(sql`${users.id} = ${userId} AND ${users.credits} >= ${delta}`)
      .returning({ credits: users.credits });

    const balance = updated[0]?.credits;
    if (balance === undefined) {
      const available = await creditBalance(userId, tx);
      throw new InsufficientCreditsError(delta, available);
    }

    await tx.insert(creditLedger).values({
      userId,
      delta: -delta,
      balanceAfter: balance,
      reason: 'verification',
      jobId,
      note,
    });

    return balance;
  });
}

/**
 * Spends up to `amount`, whichever is available, and reports what it took.
 *
 * The worker's path. A job whose row count turns out to exceed the balance
 * mid-run must not throw — the rows are already verified, the work is already
 * done, and refusing to record it would give the customer the results for
 * free while leaving the ledger claiming nothing happened. It charges what it
 * can, and the shortfall is what the caller reports.
 */
export async function consumeUpTo(
  userId: string,
  amount: number,
  { jobId = null }: { jobId?: string | null } = {},
  db: Database = getDb(),
): Promise<{ charged: number; shortfall: number; balance: number }> {
  const wanted = Math.trunc(amount);
  if (wanted <= 0) throw new RangeError('consumeUpTo requires a positive amount.');

  return db.transaction(async (tx) => {
    /*
     * `FOR UPDATE` rather than the conditional UPDATE used above, because this
     * function has to know how much it *could* take before it decides how much
     * to take — and `UPDATE ... RETURNING` in Postgres returns the new row, not
     * the old one. The row lock held for the rest of the transaction is what
     * makes read-then-write safe here.
     */
    const locked = await tx.execute<{ credits: number }>(
      sql`SELECT credits FROM ${users} WHERE ${users.id} = ${userId} FOR UPDATE`,
    );

    const available = locked.rows[0]?.credits;
    if (available === undefined) throw new Error(`No such user: ${userId}`);

    const charged = Math.min(wanted, available);
    if (charged === 0) return { charged: 0, shortfall: wanted, balance: 0 };

    const balance = available - charged;

    await tx
      .update(users)
      .set({ credits: balance, updatedAt: new Date() })
      .where(eq(users.id, userId));

    await tx.insert(creditLedger).values({
      userId,
      delta: -charged,
      balanceAfter: balance,
      reason: 'verification',
      jobId,
    });

    return { charged, shortfall: wanted - charged, balance };
  });
}

export async function creditBalance(userId: string, db: Database = getDb()): Promise<number> {
  const rows = await db
    .select({ credits: users.credits })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  return rows[0]?.credits ?? 0;
}

export async function listLedger(
  userId: string,
  limit = 50,
  db: Database = getDb(),
): Promise<CreditLedgerRow[]> {
  return db
    .select()
    .from(creditLedger)
    .where(eq(creditLedger.userId, userId))
    .orderBy(desc(creditLedger.createdAt))
    .limit(Math.min(200, Math.max(1, limit)));
}

/**
 * Recomputes the balance from the ledger and compares it with the stored one.
 *
 * Nothing calls this on a request path. It exists so that "the number is
 * wrong" is a question with an answer — run it, and either the two agree or
 * you have the account and the size of the drift.
 */
export async function reconcile(
  userId: string,
  db: Database = getDb(),
): Promise<{ stored: number; ledger: number; agrees: boolean }> {
  const [summed] = await db
    .select({ total: sql<number>`coalesce(sum(${creditLedger.delta}), 0)::int` })
    .from(creditLedger)
    .where(eq(creditLedger.userId, userId));

  const stored = await creditBalance(userId, db);
  const ledger = summed?.total ?? 0;

  return { stored, ledger, agrees: stored === ledger };
}
