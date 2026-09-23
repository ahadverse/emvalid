import { and, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { JobSummary } from '@ev/core';
import { getDb, type Database } from './client.ts';
import { jobs, type Job, type JobStatus } from './schema.ts';

/**
 * Feature 16 — the job queue, built on the jobs table.
 *
 * There is no Redis in this stack, and for this workload there does not need to
 * be. `SELECT ... FOR UPDATE SKIP LOCKED` gives exactly the one thing a queue
 * must have — two workers cannot claim the same row — and Postgres gives the
 * rest for free: the job's state, its progress and its queue position are the
 * same row, so they cannot disagree with each other, and a job cannot be
 * enqueued into a transaction that later rolls back.
 *
 * The part that takes care is not claiming, it is losing. A worker that dies
 * mid-job leaves its row `running` forever with nobody working on it, and a
 * queue that does that is not a queue, it is a trap. `reclaimStalled` is what
 * makes the difference, and it needs `heartbeatAt` to do its job — which is why
 * every write in here that a live worker performs also touches that column.
 */

/** Three tries. Past that the failure is the job's, not the infrastructure's. */
export const DEFAULT_MAX_ATTEMPTS = 3;

/**
 * Feature 24. Short on purpose: these files are lists of other people's email
 * addresses, and the safest place for them is gone.
 */
export const DEFAULT_RETENTION_DAYS = 7;

export interface JobQueueOptions {
  db?: Database;
  maxAttempts?: number;
}

export interface EnqueueInput {
  userId: string;
  originalFilename: string;
  inputPath: string;
  /** Leave at 0 when the file has not been counted yet. */
  totalRows?: number;
  /** Overrides `retentionDays`. */
  expiresAt?: Date;
  retentionDays?: number;
}

export interface FailOptions {
  /** Put the job back in the queue if it has attempts left. */
  retry?: boolean;
}

export interface ReclaimReport {
  /** Jobs handed back to the queue for another worker. */
  requeued: string[];
  /** Jobs that had run out of attempts and are now dead. */
  failed: string[];
}

/** Pure: the expiry a job created at `from` should carry. */
export function retentionExpiry(from: Date, days: number = DEFAULT_RETENTION_DAYS): Date {
  return new Date(from.getTime() + days * 24 * 60 * 60 * 1000);
}

/**
 * Pure: milliseconds as a Postgres interval literal. Built as a bound parameter
 * rather than interpolated into the SQL, so a caller cannot inject through it.
 */
export function intervalLiteral(ms: number): string {
  return `${Math.max(0, Math.round(ms))} milliseconds`;
}

/**
 * The claim, as a query. Exported unexecuted so a test can assert the shape of
 * the SQL — that it skips locked rows, takes exactly one, and takes the oldest
 * — without a database to run it against.
 */
export function claimQuery(db: Database, workerId: string) {
  return db
    .update(jobs)
    .set({
      status: 'running',
      workerId,
      // Each attempt restarts the clock: `startedAt` is when this try began,
      // which is what a user watching a retry expects to see.
      startedAt: sql`now()`,
      heartbeatAt: sql`now()`,
      attempts: sql`${jobs.attempts} + 1`,
      // A previous attempt's error would otherwise be shown next to a job that
      // is currently running fine.
      error: null,
    })
    .where(
      sql`${jobs.id} = (
        SELECT candidate.id
        FROM ${jobs} AS candidate
        WHERE candidate.status = 'queued'
        ORDER BY candidate.created_at
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )`,
    )
    .returning();
}

/**
 * The stall sweep, as a query. Also exported for the same reason — this is the
 * statement that decides whether a crashed worker costs us one job or all of
 * them, and it is worth being able to read its SQL in a test.
 */
export function reclaimStalledQuery(db: Database, olderThanMs: number, maxAttempts: number) {
  // `attempts` was already incremented when the job was claimed, so comparing
  // it against the limit here counts the try that just died.
  const hasAttemptsLeft = sql`${jobs.attempts} < ${maxAttempts}`;

  return db
    .update(jobs)
    .set({
      status: sql`CASE WHEN ${hasAttemptsLeft} THEN 'queued'::job_status ELSE 'failed'::job_status END`,
      workerId: null,
      heartbeatAt: null,
      startedAt: null,
      error: sql`COALESCE(${jobs.error}, 'worker stopped reporting progress')`,
      finishedAt: sql`CASE WHEN ${hasAttemptsLeft} THEN NULL ELSE now() END`,
    })
    .where(
      and(
        eq(jobs.status, 'running'),
        // `createdAt` is the last fallback deliberately: a row that somehow went
        // `running` without ever being stamped would otherwise never satisfy the
        // comparison, and would sit there untouched for as long as the table
        // lives — the precise failure this function exists to prevent.
        sql`COALESCE(${jobs.heartbeatAt}, ${jobs.startedAt}, ${jobs.createdAt})
              < now() - ${intervalLiteral(olderThanMs)}::interval`,
      ),
    )
    .returning({ id: jobs.id, status: jobs.status });
}

export class JobQueue {
  readonly #db: Database;
  readonly #maxAttempts: number;

  constructor(options: JobQueueOptions = {}) {
    this.#db = options.db ?? getDb();
    this.#maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  }

  get maxAttempts(): number {
    return this.#maxAttempts;
  }

  /**
   * Inserting the row *is* the enqueue — there is no second system to tell.
   * A web request can therefore write the job inside its own transaction and
   * know that if the upload bookkeeping rolls back, the job never existed.
   */
  async enqueue(input: EnqueueInput): Promise<Job> {
    const expiresAt =
      input.expiresAt ?? retentionExpiry(new Date(), input.retentionDays ?? DEFAULT_RETENTION_DAYS);

    const [job] = await this.#db
      .insert(jobs)
      .values({
        userId: input.userId,
        originalFilename: input.originalFilename,
        inputPath: input.inputPath,
        totalRows: input.totalRows ?? 0,
        status: 'queued',
        expiresAt,
      })
      .returning();

    if (job === undefined) throw new Error('failed to enqueue job');
    return job;
  }

  /**
   * Atomically takes the oldest queued job. Returns null when the queue is
   * empty, which is the normal case — a worker polls this on an idle loop.
   */
  async claim(workerId: string): Promise<Job | null> {
    const [job] = await claimQuery(this.#db, workerId);
    return job ?? null;
  }

  /**
   * "I am still alive." Returns false when the job is no longer ours — it was
   * cancelled, or a sweep decided we were dead and gave it away. A worker that
   * sees false must stop immediately, or two workers will write the same output
   * file.
   */
  async heartbeat(jobId: string, workerId?: string): Promise<boolean> {
    const owned =
      workerId === undefined
        ? and(eq(jobs.id, jobId), eq(jobs.status, 'running'))
        : and(eq(jobs.id, jobId), eq(jobs.status, 'running'), eq(jobs.workerId, workerId));

    const alive = await this.#db
      .update(jobs)
      .set({ heartbeatAt: sql`now()` })
      .where(owned)
      .returning({ id: jobs.id });

    return alive.length > 0;
  }

  /**
   * Called every chunk, so it is one indexed UPDATE by primary key with no
   * RETURNING — nothing travels back over the wire. It also refreshes the
   * heartbeat, which means a worker that is visibly making progress never needs
   * to send a separate ping to prove it.
   */
  async updateProgress(jobId: string, processedRows: number): Promise<void> {
    await this.#db
      .update(jobs)
      .set({ processedRows, heartbeatAt: sql`now()` })
      .where(eq(jobs.id, jobId));
  }

  /**
   * `processedRows` is worth passing even though progress updates already
   * write it: a job that finishes between two throttled updates would
   * otherwise be left showing the count from its last tick — "51 of 2120
   * processed" on a job that is done. The final number belongs in the same
   * statement that marks it complete.
   */
  async complete(
    jobId: string,
    summary: JobSummary,
    options: { outputPath?: string; processedRows?: number } = {},
  ): Promise<Job | null> {
    const [job] = await this.#db
      .update(jobs)
      .set({
        status: 'completed',
        summary,
        ...(options.outputPath === undefined ? {} : { outputPath: options.outputPath }),
        ...(options.processedRows === undefined
          ? {}
          : {
              processedRows: options.processedRows,
              // Nothing counts the file up front — that would mean a full
              // pass before the first address is validated — so `totalRows`
              // sits at 0 for the whole run and progress is indeterminate by
              // design. The moment the job finishes that stops being true:
              // the total is however many rows the worker read. Without this
              // a completed job keeps its "we do not know" bar forever.
              //
              // Guarded rather than assigned, so a caller that did know the
              // total up front keeps its own number.
              totalRows: sql`case when ${jobs.totalRows} = 0 then ${options.processedRows} else ${jobs.totalRows} end`,
            }),
        finishedAt: sql`now()`,
        heartbeatAt: null,
        error: null,
      })
      .where(eq(jobs.id, jobId))
      .returning();

    return job ?? null;
  }

  /**
   * The retry decision is made in SQL, not read-then-written in JS: `attempts`
   * is the same column the claim increments, and deciding on a stale copy of it
   * is how a job gets retried one time too many.
   */
  async fail(jobId: string, error: string, options: FailOptions = {}): Promise<Job | null> {
    const willRetry: SQL = sql`${options.retry === true} AND ${jobs.attempts} < ${this.#maxAttempts}`;

    const [job] = await this.#db
      .update(jobs)
      .set({
        status: sql`CASE WHEN ${willRetry} THEN 'queued'::job_status ELSE 'failed'::job_status END`,
        error,
        workerId: null,
        heartbeatAt: null,
        finishedAt: sql`CASE WHEN ${willRetry} THEN NULL ELSE now() END`,
      })
      .where(eq(jobs.id, jobId))
      .returning();

    return job ?? null;
  }

  /**
   * Returns jobs abandoned by a dead worker to the queue, and gives up on the
   * ones that have exhausted their attempts.
   *
   * `olderThanMs` must be comfortably longer than the worker's heartbeat
   * interval; too short and a slow-but-healthy worker gets its job stolen and
   * two processes write the same output.
   */
  async reclaimStalled(olderThanMs: number): Promise<ReclaimReport> {
    const rows = await reclaimStalledQuery(this.#db, olderThanMs, this.#maxAttempts);

    const report: ReclaimReport = { requeued: [], failed: [] };
    for (const row of rows) {
      if (row.status === 'queued') report.requeued.push(row.id);
      else report.failed.push(row.id);
    }
    return report;
  }

  /**
   * Cancels from outside. A worker holding the job finds out through
   * `heartbeat` returning false rather than being interrupted, so it always
   * stops at a chunk boundary with its files in a known state.
   */
  async cancel(jobId: string): Promise<boolean> {
    const cancelled = await this.#db
      .update(jobs)
      .set({ status: 'cancelled', finishedAt: sql`now()`, workerId: null, heartbeatAt: null })
      .where(and(eq(jobs.id, jobId), inArray(jobs.status, ['queued', 'running'])))
      .returning({ id: jobs.id });

    return cancelled.length > 0;
  }

  /** Puts a finished-but-wrong job back, from a dashboard "retry" button. */
  async requeue(jobId: string): Promise<Job | null> {
    const [job] = await this.#db
      .update(jobs)
      .set({
        status: 'queued',
        // Reset the counter: a human asking for a retry is a new decision, not
        // a continuation of the automatic ones that already gave up.
        attempts: 0,
        workerId: null,
        heartbeatAt: null,
        startedAt: null,
        finishedAt: null,
        error: null,
      })
      .where(and(eq(jobs.id, jobId), inArray(jobs.status, ['failed', 'cancelled'])))
      .returning();

    return job ?? null;
  }

  async get(jobId: string): Promise<Job | null> {
    const [job] = await this.#db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
    return job ?? null;
  }

  /** Feature 21 — the dashboard's job list, newest first. */
  async listByUser(
    userId: string,
    options: { limit?: number; offset?: number; status?: JobStatus } = {},
  ): Promise<Job[]> {
    const where =
      options.status === undefined
        ? eq(jobs.userId, userId)
        : and(eq(jobs.userId, userId), eq(jobs.status, options.status));

    return this.#db
      .select()
      .from(jobs)
      .where(where)
      .orderBy(desc(jobs.createdAt))
      .limit(options.limit ?? 50)
      .offset(options.offset ?? 0);
  }
}
