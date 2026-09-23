import { desc, eq, sql } from 'drizzle-orm';
import { getDb, type Database } from './client.ts';
import { grantCredits } from './credits.ts';
import {
  orders,
  subscriptions,
  users,
  type Order,
  type OrderStatus,
  type Subscription,
} from './schema.ts';

/**
 * Feature 26 — orders, and what settling one does.
 *
 * There is no payment gateway. An order is placed by the customer, paid out of
 * band (bKash, bank transfer), and marked paid by an admin who has seen the
 * money. `markOrderPaid` is therefore the single place where money becomes
 * capability, and it does three things in one transaction or none of them:
 *
 *   1. flips the order to paid
 *   2. grants the credits the order was priced for
 *   3. opens or extends the subscription period
 *
 * When a gateway is wired up it calls this same function from a webhook. The
 * shape of the row does not change; only who writes it does.
 */

export interface PlaceOrderInput {
  userId: string;
  planId: string;
  periodMonths: number;
  amountTaka: number;
  credits: number;
  note?: string | null;
}

export async function placeOrder(
  input: PlaceOrderInput,
  db: Database = getDb(),
): Promise<Order> {
  const inserted = await db
    .insert(orders)
    .values({
      userId: input.userId,
      planId: input.planId,
      periodMonths: Math.max(1, Math.trunc(input.periodMonths)),
      amountTaka: Math.max(0, Math.trunc(input.amountTaka)),
      credits: Math.max(1, Math.trunc(input.credits)),
      note: input.note ?? null,
    })
    .returning();

  const order = inserted[0];
  if (order === undefined) throw new Error('Order insert returned no row.');
  return order;
}

export class OrderNotPendingError extends Error {
  constructor(readonly status: OrderStatus) {
    super(`Only a pending order can be settled; this one is ${status}.`);
    this.name = 'OrderNotPendingError';
  }
}

/**
 * Settles an order: money in, credits out, period extended.
 *
 * Idempotent by construction. The `WHERE status = 'pending'` means a double
 * click, a retried webhook or two admins clicking at once can only ever match
 * once — the second attempt updates no row and is told the order is already
 * paid, rather than granting the credits a second time.
 */
export async function markOrderPaid(
  orderId: string,
  { settledBy = null, providerRef = null }: { settledBy?: string | null; providerRef?: string | null } = {},
  db: Database = getDb(),
): Promise<{ order: Order; balance: number; subscription: Subscription }> {
  return db.transaction(async (tx) => {
    const updated = await tx
      .update(orders)
      .set({
        status: 'paid',
        paidAt: new Date(),
        settledBy,
        ...(providerRef === null ? {} : { providerRef }),
      })
      .where(sql`${orders.id} = ${orderId} AND ${orders.status} = 'pending'`)
      .returning();

    const order = updated[0];
    if (order === undefined) {
      const existing = await tx.select().from(orders).where(eq(orders.id, orderId)).limit(1);
      const found = existing[0];
      if (found === undefined) throw new Error(`No such order: ${orderId}`);
      throw new OrderNotPendingError(found.status);
    }

    const balance = await grantCredits(
      order.userId,
      order.credits,
      { reason: 'purchase', orderId: order.id, note: `${order.planId} · ${order.periodMonths}mo` },
      tx,
    );

    const subscription = await extendSubscription(
      order.userId,
      order.planId,
      order.periodMonths,
      tx,
    );

    return { order, balance, subscription };
  });
}

export async function cancelOrder(
  orderId: string,
  db: Database = getDb(),
): Promise<Order | null> {
  const updated = await db
    .update(orders)
    .set({ status: 'cancelled' })
    .where(sql`${orders.id} = ${orderId} AND ${orders.status} = 'pending'`)
    .returning();

  return updated[0] ?? null;
}

/**
 * Opens a period, or adds to the one already running.
 *
 * Extending from `current_period_end` rather than from today is the difference
 * between renewing early costing you nothing and renewing early costing you
 * the unused remainder of the month you already paid for.
 */
export async function extendSubscription(
  userId: string,
  planId: string,
  months: number,
  db: Database = getDb(),
): Promise<Subscription> {
  const now = new Date();

  const existing = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.userId, userId))
    .limit(1);

  const current = existing[0];
  const base =
    current !== undefined && current.currentPeriodEnd > now ? current.currentPeriodEnd : now;

  const end = new Date(base);
  end.setUTCMonth(end.getUTCMonth() + Math.max(1, Math.trunc(months)));

  const rows = await db
    .insert(subscriptions)
    .values({ userId, planId, status: 'active', currentPeriodEnd: end })
    .onConflictDoUpdate({
      target: subscriptions.userId,
      set: { planId, status: 'active', currentPeriodEnd: end, updatedAt: now },
    })
    .returning();

  const subscription = rows[0];
  if (subscription === undefined) throw new Error('Subscription upsert returned no row.');
  return subscription;
}

export async function findSubscription(
  userId: string,
  db: Database = getDb(),
): Promise<Subscription | null> {
  const rows = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.userId, userId))
    .limit(1);

  const row = rows[0];
  if (row === undefined) return null;

  // Reported as expired the moment the period ends, without waiting for a
  // sweep to write the column. A cron that has not run yet must never be the
  // reason someone keeps access they stopped paying for.
  if (row.currentPeriodEnd <= new Date() && row.status === 'active') {
    return { ...row, status: 'expired' };
  }

  return row;
}

export async function listOrders(
  userId: string,
  limit = 50,
  db: Database = getDb(),
): Promise<Order[]> {
  return db
    .select()
    .from(orders)
    .where(eq(orders.userId, userId))
    .orderBy(desc(orders.createdAt))
    .limit(Math.min(200, Math.max(1, limit)));
}

export interface AdminOrderRow {
  order: Order;
  userEmail: string;
  userName: string | null;
}

/** The admin queue. Pending first — those are the ones with work attached. */
export async function listOrdersForAdmin(
  { status, limit = 100 }: { status?: OrderStatus; limit?: number } = {},
  db: Database = getDb(),
): Promise<AdminOrderRow[]> {
  const query = db
    .select({ order: orders, userEmail: users.email, userName: users.name })
    .from(orders)
    .innerJoin(users, eq(users.id, orders.userId))
    .$dynamic();

  if (status !== undefined) query.where(eq(orders.status, status));

  return query
    .orderBy(sql`(${orders.status} = 'pending') DESC`, desc(orders.createdAt))
    .limit(Math.min(500, Math.max(1, limit)));
}

export async function findOrder(orderId: string, db: Database = getDb()): Promise<Order | null> {
  const rows = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  return rows[0] ?? null;
}
