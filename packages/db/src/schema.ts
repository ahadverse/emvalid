import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import type { JobSummary, MxProvider } from '@ev/core';

/**
 * The schema.
 *
 * v1 was four tables: users, api_keys, jobs, domain_cache. v2 adds the SaaS
 * layer on top of them — sessions, subscriptions, orders and a credit ledger —
 * without changing what v1 stored.
 *
 * Column names are written out in snake_case rather than derived, so a hand
 * written migration and the schema can be read side by side and compared.
 *
 * The rule the whole package exists to enforce still holds: **email addresses
 * never become rows.** A ten-million-row job is a file on disk. The only
 * addresses in Postgres are the ones people log in with.
 */

export const jobStatusValues = [
  'queued',
  'running',
  'completed',
  'failed',
  'cancelled',
] as const;

export type JobStatus = (typeof jobStatusValues)[number];

/**
 * A real Postgres enum, not a text column with a check. Adding a state later
 * costs an `ALTER TYPE ... ADD VALUE`, which is cheap; the payoff is that a
 * worker can never write a typo into the column the queue claims on.
 */
export const jobStatusEnum = pgEnum('job_status', jobStatusValues);

export const userRoleValues = ['user', 'admin'] as const;
export type UserRole = (typeof userRoleValues)[number];
export const userRoleEnum = pgEnum('user_role', userRoleValues);

export const userStatusValues = ['active', 'suspended'] as const;
export type UserStatus = (typeof userStatusValues)[number];
export const userStatusEnum = pgEnum('user_status', userStatusValues);

/** Feature 32. */
export const resultFormatValues = ['csv', 'json', 'xlsx'] as const;
export type ResultFormat = (typeof resultFormatValues)[number];
export const resultFormatEnum = pgEnum('result_format', resultFormatValues);

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** Stored lowercased. The unique index is what makes that matter. */
  email: text('email').notNull().unique(),
  /**
   * Null only for accounts that pre-date logins — the v1 seed owner, and any
   * account an admin creates before the user sets a password. A null hash can
   * never authenticate; `verifyPassword` refuses it rather than comparing.
   */
  passwordHash: text('password_hash'),
  name: text('name'),
  role: userRoleEnum('role').notNull().default('user'),
  status: userStatusEnum('status').notNull().default('active'),
  /**
   * Materialised credit balance — one verification, one credit.
   *
   * Duplicated from `credit_ledger`, which is the record of truth, because the
   * alternative is a `SUM()` over every verification the account has ever run
   * on the hot path of every upload. Both are written in one transaction (see
   * credits.ts); the ledger is what an audit reads.
   */
  credits: integer('credits').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Feature 25 — logins.
 *
 * A server-side session table rather than a signed stateless cookie, for one
 * reason: revocation. "Log out everywhere" and an admin suspending an account
 * both have to take effect on the next request, and a self-contained JWT
 * cannot be taken back before it expires.
 *
 * Only the SHA-256 of the token is stored, exactly as for API keys — a dump of
 * this table cannot be replayed as a login.
 */
export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    /** Rolled forward on use, so an idle session can be expired separately. */
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('sessions_user_id_idx').on(table.userId),
    // The expiry sweep orders by this on a table that only grows.
    index('sessions_expires_at_idx').on(table.expiresAt),
  ],
);

export const orderStatusValues = ['pending', 'paid', 'cancelled', 'refunded'] as const;
export type OrderStatus = (typeof orderStatusValues)[number];
export const orderStatusEnum = pgEnum('order_status', orderStatusValues);

/**
 * Feature 26 — an order is a request to buy a plan period.
 *
 * There is no payment gateway yet, so an order is settled out of band: the
 * customer pays by bKash or bank transfer, quotes `reference`, and an admin
 * marks it paid. That is deliberately the same shape a gateway would produce —
 * `provider` and `provider_ref` are already here — so switching to an
 * automated callback later changes who writes the row, not what a row means.
 *
 * Amounts are whole taka. Not paisa: every price in this product is a round
 * hundred, and a minor-unit column that is always ×100 invites exactly one
 * off-by-100 bug and prevents none.
 */
export const orders = pgTable(
  'orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Matches a plan id in the app's plan table. Text, not a foreign key —
        plans are code, and an old order must keep naming the plan it bought
        even after that plan is withdrawn. */
    planId: text('plan_id').notNull(),
    /** 1 for monthly, 12 for yearly. Decides the period the payment opens. */
    periodMonths: integer('period_months').notNull().default(1),
    amountTaka: integer('amount_taka').notNull(),
    /** Credits the order grants once paid, frozen at the moment it was placed. */
    credits: integer('credits').notNull(),
    status: orderStatusEnum('status').notNull().default('pending'),
    /** 'manual' today; a gateway name when one is wired up. */
    provider: text('provider').notNull().default('manual'),
    /** The customer's bKash/bank reference, or the gateway's transaction id. */
    providerRef: text('provider_ref'),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    /** Which admin settled it. Null for anything a gateway confirms itself. */
    settledBy: uuid('settled_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (table) => [
    index('orders_user_id_created_at_idx').on(table.userId, table.createdAt),
    index('orders_status_idx').on(table.status),
  ],
);

export const subscriptionStatusValues = ['active', 'expired', 'cancelled'] as const;
export type SubscriptionStatus = (typeof subscriptionStatusValues)[number];
export const subscriptionStatusEnum = pgEnum('subscription_status', subscriptionStatusValues);

/**
 * Feature 27 — what plan an account is on, and until when.
 *
 * One row per account, replaced rather than versioned: the history of what was
 * bought lives in `orders`, which is the thing an accountant reads. This table
 * only has to answer "what may this account do right now".
 */
export const subscriptions = pgTable(
  'subscriptions',
  {
    userId: uuid('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    planId: text('plan_id').notNull(),
    status: subscriptionStatusEnum('status').notNull().default('active'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('subscriptions_current_period_end_idx').on(table.currentPeriodEnd)],
);

export const creditReasonValues = [
  'signup_grant',
  'purchase',
  'verification',
  'refund',
  'admin_adjustment',
] as const;
export type CreditReason = (typeof creditReasonValues)[number];
export const creditReasonEnum = pgEnum('credit_reason', creditReasonValues);

/**
 * Append-only. Nothing updates or deletes a row here.
 *
 * `delta` is signed: grants and purchases are positive, verifications
 * negative. `balance_after` is stored rather than recomputed so a disagreement
 * between the ledger and `users.credits` can be located at the row that caused
 * it instead of inferred from a total.
 */
export const creditLedger = pgTable(
  'credit_ledger',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    delta: integer('delta').notNull(),
    balanceAfter: integer('balance_after').notNull(),
    reason: creditReasonEnum('reason').notNull(),
    /** Set on 'verification' rows. Survives the job being deleted by retention. */
    jobId: uuid('job_id'),
    orderId: uuid('order_id').references(() => orders.id, { onDelete: 'set null' }),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('credit_ledger_user_id_created_at_idx').on(table.userId, table.createdAt)],
);

/**
 * Feature 20 — API key authentication.
 *
 * The raw key is shown once, at creation, and then never again: only its
 * SHA-256 lives here. A dump of this table therefore cannot be replayed against
 * the API. `prefix` exists purely so the dashboard can say "ev_live_a1b2c3d4…"
 * and the user can tell their keys apart without us storing the secret.
 */
export const apiKeys = pgTable(
  'api_keys',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    keyHash: text('key_hash').notNull().unique(),
    prefix: text('prefix').notNull(),
    /** Written on use; lets a user spot a key nobody calls any more. */
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    /** Revoked rather than deleted, so an audit trail survives. */
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('api_keys_user_id_idx').on(table.userId)],
);

/**
 * Feature 16 — one row per uploaded file, and simultaneously the queue itself.
 * See `queue.ts` for why a table is enough.
 */
export const jobs = pgTable(
  'jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    status: jobStatusEnum('status').notNull().default('queued'),
    /** What the user called the file. Shown in the dashboard, never used as a path. */
    originalFilename: text('original_filename').notNull(),
    inputPath: text('input_path').notNull(),
    /** Null until the job finishes — a failed job has nothing to download. */
    outputPath: text('output_path'),
    /** Feature 32 — chosen at upload time; decides both `outputPath`'s extension and the download route's Content-Type. */
    resultFormat: resultFormatEnum('result_format').notNull().default('csv'),
    /** 0 until the file has been counted; progress is meaningless before then. */
    totalRows: integer('total_rows').notNull().default(0),
    processedRows: integer('processed_rows').notNull().default(0),
    /** `JobSummary` from @ev/core — feature 18. jsonb so the shape can grow. */
    summary: jsonb('summary').$type<JobSummary>(),
    error: text('error'),
    attempts: integer('attempts').notNull().default(0),
    /**
     * Who is holding the job, and when they last said so. A crashed worker
     * stops updating these, which is the only evidence `reclaimStalled` has.
     */
    workerId: text('worker_id'),
    heartbeatAt: timestamp('heartbeat_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    /** Feature 24 — after this instant the row and its files are deleted. */
    expiresAt: timestamp('expires_at', { withTimezone: true }),
  },
  (table) => [
    // The queue claim orders queued jobs oldest first; this index is what keeps
    // that a lookup instead of a sort over every job ever run.
    index('jobs_status_created_at_idx').on(table.status, table.createdAt),
    // Retention sweeps by expiry, on a table that only grows.
    index('jobs_expires_at_idx').on(table.expiresAt),
    // Feature 21 — the dashboard lists one user's jobs, newest first.
    index('jobs_user_id_created_at_idx').on(table.userId, table.createdAt),
  ],
);

/**
 * Feature 22 — the persistent half of the domain cache.
 *
 * Deliberately not modelled as a cache of `DomainInfo` verbatim: `error` has no
 * column because a failed lookup is never stored (see `domain-cache.ts`), so a
 * row here always means "we know this". Freshness is `checked_at` plus a TTL
 * applied at read time, not an expiry column, so the TTL can be retuned without
 * a backfill.
 *
 * `parked` is the one exception to "a row always means we know this" — it is
 * nullable on purpose (migration 0004). A row from before that migration, or
 * one whose NS lookup failed, has no opinion on parking; NULL is "not
 * checked", never "not parked". See `DomainInfo.parked` in @ev/core.
 */
export const domainCache = pgTable(
  'domain_cache',
  {
    domain: text('domain').primaryKey(),
    mx: text('mx')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    nullMx: boolean('null_mx').notNull().default(false),
    hasAddressRecord: boolean('has_address_record').notNull().default(false),
    nxdomain: boolean('nxdomain').notNull().default(false),
    provider: text('provider').$type<MxProvider>(),
    parked: boolean('parked'),
    checkedAt: timestamp('checked_at', { withTimezone: true }).notNull().defaultNow(),
  },
  // Both the TTL read filter and the retention purge order by this column.
  (table) => [index('domain_cache_checked_at_idx').on(table.checkedAt)],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type ApiKey = typeof apiKeys.$inferSelect;
export type NewApiKey = typeof apiKeys.$inferInsert;
export type Job = typeof jobs.$inferSelect;
export type NewJob = typeof jobs.$inferInsert;
export type DomainCacheRow = typeof domainCache.$inferSelect;
export type Order = typeof orders.$inferSelect;
export type NewOrder = typeof orders.$inferInsert;
export type Subscription = typeof subscriptions.$inferSelect;
export type CreditLedgerRow = typeof creditLedger.$inferSelect;
