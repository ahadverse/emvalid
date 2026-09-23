import { rm } from 'node:fs/promises';
import { inArray, sql } from 'drizzle-orm';
import { getDb, type Database } from './client.ts';
import { domainCache, jobs } from './schema.ts';

/**
 * Feature 24 — automatic data retention.
 *
 * We hold lists of other people's email addresses. Keeping them one day longer
 * than the product needs is a liability with no upside, so expired jobs take
 * their files with them.
 */

export interface RetentionLogger {
  info(message: string, data?: Record<string, unknown>): void;
}

export interface RetentionOptions {
  db?: Database;
  /**
   * Ceiling on rows per sweep. A neglected instance can accumulate a very large
   * backlog, and deleting it in one statement would hold locks on `jobs` for
   * minutes while the queue tries to claim from the same table.
   */
  batchSize?: number;
  logger?: RetentionLogger;
}

export interface FileRemovalResult {
  deleted: number;
  failed: Array<{ path: string; error: string }>;
}

export interface RetentionResult {
  jobs: number;
  files: FileRemovalResult;
}

/** Pure: the instant `days` ago. */
export function daysAgo(days: number, now: Date = new Date()): Date {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

/**
 * Unlinks a job's files. `force` swallows ENOENT because a missing file is the
 * desired end state, and because a previous interrupted sweep is the most
 * likely reason for one.
 */
export async function removeFiles(paths: readonly (string | null)[]): Promise<FileRemovalResult> {
  const result: FileRemovalResult = { deleted: 0, failed: [] };

  for (const path of paths) {
    if (path === null || path === '') continue;
    try {
      await rm(path, { force: true });
      result.deleted++;
    } catch (error) {
      result.failed.push({ path, error: error instanceof Error ? error.message : String(error) });
    }
  }

  return result;
}

/**
 * Deletes jobs past their `expiresAt`, files first.
 *
 * The order is the whole point. Crash after unlinking but before the DELETE and
 * the row survives pointing at a file that is gone — ugly, self-correcting, and
 * the next sweep finishes the job. Do it the other way round and a crash leaves
 * a file on disk that no row mentions: nothing will ever look for it again, and
 * it holds user data forever. One of those failures is noise, the other is the
 * bug this feature exists to prevent.
 *
 * For the same reason a job whose file could not be removed keeps its row: the
 * row is the only record that the file needs deleting.
 */
export async function deleteExpiredJobs(options: RetentionOptions = {}): Promise<RetentionResult> {
  const db = options.db ?? getDb();
  const logger = options.logger ?? console;

  const expired = await db
    .select({ id: jobs.id, inputPath: jobs.inputPath, outputPath: jobs.outputPath })
    .from(jobs)
    .where(sql`${jobs.expiresAt} IS NOT NULL AND ${jobs.expiresAt} < now()`)
    .limit(options.batchSize ?? 500);

  if (expired.length === 0) return { jobs: 0, files: { deleted: 0, failed: [] } };

  const files: FileRemovalResult = { deleted: 0, failed: [] };
  const deletable: string[] = [];

  for (const job of expired) {
    const removal = await removeFiles([job.inputPath, job.outputPath]);
    files.deleted += removal.deleted;
    files.failed.push(...removal.failed);
    if (removal.failed.length === 0) deletable.push(job.id);
  }

  const deleted =
    deletable.length === 0
      ? []
      : await db.delete(jobs).where(inArray(jobs.id, deletable)).returning({ id: jobs.id });

  logger.info('[retention] deleted expired jobs', {
    jobs: deleted.length,
    files: files.deleted,
    retained: expired.length - deleted.length,
    fileErrors: files.failed,
  });

  return { jobs: deleted.length, files };
}

/**
 * Trims the domain cache. Rows past the read TTL are already ignored, so this
 * is about table size, not correctness — hence a threshold well beyond the TTL:
 * raising the TTL later should be a config change, not a cold cache.
 */
export async function purgeStaleDomainCache(
  olderThanDays = 90,
  options: RetentionOptions = {},
): Promise<number> {
  const db = options.db ?? getDb();
  const logger = options.logger ?? console;

  const purged = await db
    .delete(domainCache)
    .where(sql`${domainCache.checkedAt} < ${daysAgo(olderThanDays)}`)
    .returning({ domain: domainCache.domain });

  logger.info('[retention] purged stale domain cache rows', {
    domains: purged.length,
    olderThanDays,
  });

  return purged.length;
}
