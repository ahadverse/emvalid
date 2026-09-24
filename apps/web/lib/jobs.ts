import 'server-only';

import { getQueue, type Job, type JobStatus as DbJobStatus } from '@ev/db';
import { RETENTION_DAYS } from './config';
import type { JobRecord } from './dto';
import type { JobStatus } from './format';

/**
 * The web app's view of the jobs table.
 *
 * Everything goes through @ev/db's `JobQueue` rather than raw drizzle, so the
 * app has no opinion about the schema and no second place where a query could
 * drift from the worker's. What is added here is the two things the queue
 * deliberately does not do: scoping reads to a user, and flattening rows into
 * JSON-safe records for the client.
 */

export type { JobRecord } from './dto';

/**
 * Maps @ev/db's job status onto the one the UI can style. Exhaustive by
 * construction: if @ev/db ever adds a state, this stops compiling instead of
 * rendering an unlabelled chip in production.
 */
const STATUS: Record<DbJobStatus, JobStatus> = {
  queued: 'queued',
  running: 'running',
  completed: 'completed',
  failed: 'failed',
  cancelled: 'cancelled',
};

export interface NewJobInput {
  userId: string;
  originalFilename: string;
  inputPath: string;
}

export async function createJob(input: NewJobInput): Promise<JobRecord> {
  const job = await getQueue().enqueue({
    userId: input.userId,
    originalFilename: input.originalFilename,
    inputPath: input.inputPath,
    // `totalRows` is left at its default of 0 on purpose. Only the worker can
    // know the real count — it emerges after parsing and alias-aware
    // deduplication — and the UI shows an indeterminate bar until it does,
    // rather than a percentage of a number nobody has measured.
    retentionDays: RETENTION_DAYS,
  });

  return toRecord(job);
}

export async function listJobs(userId: string, limit = 50): Promise<JobRecord[]> {
  const rows = await getQueue().listByUser(userId, { limit });
  return rows.map(toRecord);
}

/**
 * `JobQueue.get` takes an id and nothing else, so the ownership check lives
 * here. A job id must never be enough on its own to read someone's list.
 */
export async function getJob(userId: string, jobId: string): Promise<JobRecord | null> {
  const job = await getQueue().get(jobId);
  if (job === null || job.userId !== userId) return null;
  return toRecord(job);
}

/** The download route needs the path itself, which never leaves the server. */
export async function getJobOutputPath(
  userId: string,
  jobId: string,
): Promise<{ path: string; originalFilename: string } | null> {
  const job = await getQueue().get(jobId);

  if (job === null || job.userId !== userId) return null;
  if (job.status !== 'completed' || job.outputPath === null) return null;

  return { path: job.outputPath, originalFilename: job.originalFilename };
}

/**
 * Records cross into client components, where a `Date` cannot survive
 * serialisation and `inputPath` has no business travelling at all.
 */
function toRecord(job: Job): JobRecord {
  return {
    id: job.id,
    status: STATUS[job.status],
    originalFilename: job.originalFilename,
    totalRows: job.totalRows,
    processedRows: job.processedRows,
    summary: job.summary,
    error: job.error,
    attempts: job.attempts,
    createdAt: job.createdAt.toISOString(),
    startedAt: job.startedAt?.toISOString() ?? null,
    finishedAt: job.finishedAt?.toISOString() ?? null,
    expiresAt: job.expiresAt?.toISOString() ?? null,
    downloadable: job.status === 'completed' && job.outputPath !== null,
  };
}
