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

/**
 * How a stored object is destroyed, supplied by the caller.
 *
 * This package used to unlink the path itself, which stopped being possible
 * the moment the files moved off the worker's own disk and into a bucket. It
 * is injected rather than imported so @ev/db keeps knowing nothing about
 * storage — and so the sweep can be tested without one.
 *
 * The contract is the one `rm --force` had: returning normally means the object
 * is gone, and an object that was already gone counts as gone. Only a real
 * failure — no credentials, a refused connection — may throw.
 */
export type RemoveObject = (key: string) => Promise<void>;

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

export interface ObjectRemovalResult {
  deleted: number;
  failed: Array<{ key: string; error: string }>;
}

export interface RetentionResult {
  jobs: number;
  objects: ObjectRemovalResult;
}

/** Pure: the instant `days` ago. */
export function daysAgo(days: number, now: Date = new Date()): Date {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

/**
 * Destroys a job's stored objects, collecting failures rather than stopping at
 * the first. A sweep that gave up on one unreachable object would leave every
 * later job's data in place too, which is the opposite of what this is for.
 */
export async function removeObjects(
  keys: readonly (string | null)[],
  remove: RemoveObject,
): Promise<ObjectRemovalResult> {
  const result: ObjectRemovalResult = { deleted: 0, failed: [] };

  for (const key of keys) {
    if (key === null || key === '') continue;
    try {
      await remove(key);
      result.deleted++;
    } catch (error) {
      result.failed.push({ key, error: error instanceof Error ? error.message : String(error) });
    }
  }

  return result;
}

/**
 * Deletes jobs past their `expiresAt`, objects first.
 *
 * The order is the whole point. Crash after removing the objects but before the
 * DELETE and the row survives pointing at something that is gone — ugly,
 * self-correcting, and the next sweep finishes the job. Do it the other way
 * round and a crash leaves an object in the bucket that no row mentions:
 * nothing will ever look for it again, and it holds user data forever. One of
 * those failures is noise, the other is the bug this feature exists to prevent.
 *
 * For the same reason a job whose objects could not be removed keeps its row:
 * the row is the only record that they still need deleting.
 */
export async function deleteExpiredJobs(
  remove: RemoveObject,
  options: RetentionOptions = {},
): Promise<RetentionResult> {
  const db = options.db ?? getDb();
  const logger = options.logger ?? console;

  const expired = await db
    .select({ id: jobs.id, inputPath: jobs.inputPath, outputPath: jobs.outputPath })
    .from(jobs)
    .where(sql`${jobs.expiresAt} IS NOT NULL AND ${jobs.expiresAt} < now()`)
    .limit(options.batchSize ?? 500);

  if (expired.length === 0) return { jobs: 0, objects: { deleted: 0, failed: [] } };

  const objects: ObjectRemovalResult = { deleted: 0, failed: [] };
  const deletable: string[] = [];

  for (const job of expired) {
    const removal = await removeObjects([job.inputPath, job.outputPath], remove);
    objects.deleted += removal.deleted;
    objects.failed.push(...removal.failed);
    if (removal.failed.length === 0) deletable.push(job.id);
  }

  const deleted =
    deletable.length === 0
      ? []
      : await db.delete(jobs).where(inArray(jobs.id, deletable)).returning({ id: jobs.id });

  logger.info('[retention] deleted expired jobs', {
    jobs: deleted.length,
    objects: objects.deleted,
    retained: expired.length - deleted.length,
    objectErrors: objects.failed,
  });

  return { jobs: deleted.length, objects };
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
