import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { EmailValidator, MemoryDomainCache, TieredDomainCache } from '@ev/core';
import {
  PostgresDomainCache,
  consumeUpTo,
  deleteExpiredJobs,
  getQueue,
  purgeExpiredSessions,
  purgeStaleDomainCache,
  type Job,
} from '@ev/db';
import { processFile, resultFileExtension } from '@ev/pipeline';
import { config } from './config.ts';
import { refreshDisposableList } from './disposable-refresh.ts';
import { log } from './log.ts';

/**
 * The bulk worker. One process, one job at a time, forever.
 *
 * Deliberately single-job: a ten-million-row file already saturates the DNS
 * concurrency ceiling on its own, so running two jobs side by side would not
 * make either finish sooner — it would just make both slower and double the
 * memory. Scale by running more worker processes when there is more than one
 * machine, not by widening this loop.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

const queue = getQueue();

const validator = new EmailValidator({
  cache: new TieredDomainCache(
    new MemoryDomainCache({
      maxEntries: config.memoryCacheEntries,
      ttlMs: config.domainCacheTtlDays * DAY_MS,
    }),
    new PostgresDomainCache({ ttlMs: config.domainCacheTtlDays * DAY_MS }),
  ),
  servers: config.dnsServers,
  timeout: config.dnsTimeoutMs,
  tries: config.dnsTries,
  concurrency: config.dnsConcurrency,
});

/** Flipped by SIGINT/SIGTERM; the loop finishes what it can and stops. */
let shuttingDown = false;
let currentJob: { id: string; abort: AbortController } | null = null;

async function runJob(job: Job): Promise<void> {
  const abort = new AbortController();
  currentJob = { id: job.id, abort };

  const outputPath =
    job.outputPath ?? join(config.dataDir, 'results', `${job.id}${resultFileExtension(job.resultFormat)}`);
  await mkdir(dirname(outputPath), { recursive: true });

  // Progress writes are cheap but not free, and a big job would otherwise
  // hammer the database with them. The heartbeat rides along with the
  // progress update so a live job is never mistaken for a stalled one.
  let lastBeat = 0;
  // Tracked on every callback, not just the ones that reach the database, so
  // the number handed to `complete` is the real final count.
  let processedRows = 0;

  /**
   * Feature 27 — the meter.
   *
   * Charged as the file streams past, not at the end. A ten-million-row job
   * from an account with a thousand credits must stop after a thousand rows,
   * and a charge that only happens on completion would have already done all
   * ten million lookups by the time it noticed.
   *
   * The web app's upload route only checks that the balance is non-zero — the
   * row count is unknowable until the file has been read, so this is the only
   * place the exact number can be settled.
   */
  let chargedRows = 0;
  let ranOutOfCredits = false;

  /**
   * Charges are serialised through this chain, and that is not decoration.
   *
   * The progress callback cannot await — it is called from inside the row
   * pipeline — so it fires `chargeTo` and moves on. Without the chain, that
   * in-flight charge and the final one at the end of the job both read
   * `chargedRows` before either has written it back, and a six-row file gets
   * billed twelve credits. Both callers now queue behind the same promise, so
   * each one reads a `chargedRows` that already includes every charge before
   * it.
   */
  let chargeQueue: Promise<void> = Promise.resolve();

  function chargeTo(processed: number): Promise<void> {
    const next = chargeQueue.then(async () => {
      const owed = processed - chargedRows;
      if (owed <= 0) return;

      const { charged, shortfall } = await consumeUpTo(job.userId, owed, { jobId: job.id });
      chargedRows += charged;

      if (shortfall > 0) {
        // Everything already verified has been charged for; there is nothing
        // left to pay for the rest, so stop reading the file.
        ranOutOfCredits = true;
        abort.abort();
      }
    });

    /*
     * The queue continues from a *settled* promise, not from `next` itself. A
     * rejected link would otherwise make every `.then()` after it skip its
     * callback, so one failed charge — a dropped connection, say — would
     * silently stop billing for the rest of the file. The caller still sees
     * the rejection, through the promise returned below.
     */
    chargeQueue = next.catch(() => {});
    return next;
  }

  const startedAt = Date.now();
  log.info('job.start', { jobId: job.id, file: job.originalFilename });

  try {
    const { summary, column, format } = await processFile({
      inputPath: job.inputPath,
      outputPath,
      format: job.resultFormat,
      validator,
      batchSize: config.batchSize,
      signal: abort.signal,
      onProgress: ({ processed }) => {
        processedRows = processed;

        const now = Date.now();
        if (now - lastBeat < 2000) return;
        lastBeat = now;
        void queue.updateProgress(job.id, processed).catch((error: unknown) => {
          log.warn('job.progress_failed', { jobId: job.id, error: String(error) });
        });
        void queue.heartbeat(job.id).catch(() => {});
        // Same throttle as the progress write, for the same reason: one row is
        // not worth a transaction. The catch also keeps a failed charge from
        // rejecting the shared queue and poisoning every charge after it.
        void chargeTo(processed).catch((error: unknown) => {
          log.warn('job.charge_failed', { jobId: job.id, error: String(error) });
        });
      },
    });

    // The last partial chunk since the final throttled tick. Awaited, unlike
    // the ones above, because the job is about to be marked complete and an
    // uncharged tail is revenue that silently never happened.
    await chargeTo(processedRows);

    await queue.complete(job.id, summary, { outputPath, processedRows });

    const seconds = Math.round((Date.now() - startedAt) / 1000);
    log.info('job.done', {
      jobId: job.id,
      format,
      rows: summary.total,
      seconds,
      coverage: `${summary.coverage}%`,
      cacheHits: validator.resolver.stats.cacheHits,
      dnsQueries: validator.resolver.stats.dnsQueries,
    });

    // A low-confidence column pick is the one failure that looks like success
    // — the job completes, the summary reads plausibly, and every address was
    // read from the wrong column. Worth a line in the log every time.
    if (column.confidence < 70) {
      log.warn('job.column_uncertain', {
        jobId: job.id,
        column: column.index + 1,
        confidence: column.confidence,
        reason: column.reason,
      });
    }
  } catch (error) {
    if (ranOutOfCredits) {
      /*
       * Not retryable. Handing this back to the queue would restart the file
       * from row one against a balance that is now zero, and burn an attempt
       * every time. The customer's move is to buy credits and upload again.
       */
      await queue.fail(
        job.id,
        `Ran out of verification credits after ${chargedRows.toLocaleString('en-US')} rows. ` +
          'Add credits and upload the file again.',
        { retry: false },
      );
      log.warn('job.out_of_credits', { jobId: job.id, userId: job.userId, charged: chargedRows });
      return;
    }

    if (abort.signal.aborted) {
      // We asked it to stop, so this is not a failure of the job. Hand it
      // back to the queue rather than burning one of its attempts.
      await queue.fail(job.id, 'Worker shutting down', { retry: true });
      log.info('job.requeued', { jobId: job.id });
      return;
    }

    const message = error instanceof Error ? error.message : String(error);
    // A malformed file will fail identically on every retry. A database
    // hiccup will not. We cannot tell them apart here, so let the queue's
    // attempt limit settle it.
    await queue.fail(job.id, message, { retry: true });
    log.error('job.failed', { jobId: job.id, error: message });
  } finally {
    currentJob = null;
  }
}

async function workLoop(): Promise<void> {
  while (!shuttingDown) {
    let job = null;

    try {
      job = await queue.claim(config.workerId);
    } catch (error) {
      log.error('queue.claim_failed', { error: String(error) });
      await sleep(config.idlePollMs);
      continue;
    }

    if (job === null) {
      await sleep(config.idlePollMs);
      continue;
    }

    await runJob(job);
  }
}

/**
 * Housekeeping that has nothing to do with any one job: expired data goes
 * away (feature 24), jobs abandoned by a dead worker come back to the queue,
 * and the disposable-domain list stays current (feature 8).
 */
function startMaintenance(): NodeJS.Timeout[] {
  const sweep = async () => {
    try {
      const stalled = await queue.reclaimStalled(config.stalledAfterMs);
      if (stalled.requeued.length > 0 || stalled.failed.length > 0) {
        log.warn('queue.reclaimed', {
          requeued: stalled.requeued.length,
          gaveUp: stalled.failed.length,
        });
      }

      const retention = await deleteExpiredJobs({ logger: { info: log.info } });
      if (retention.jobs > 0) {
        log.info('retention.deleted', { jobs: retention.jobs, files: retention.files.deleted });
      }

      const purged = await purgeStaleDomainCache(config.domainCacheTtlDays * 2);
      if (purged > 0) log.info('retention.domain_cache_purged', { rows: purged });

      // Expired login sessions are dead weight on a table that only grows.
      const sessions = await purgeExpiredSessions();
      if (sessions > 0) log.info('retention.sessions_purged', { rows: sessions });
    } catch (error) {
      log.error('maintenance.failed', { error: String(error) });
    }
  };

  void sweep();
  return [
    setInterval(() => void sweep(), config.retentionIntervalMs),
    setInterval(() => void refreshDisposableList(), 12 * 60 * 60 * 1000),
  ];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function installShutdown(timers: NodeJS.Timeout[]): void {
  const stop = (signal: string) => {
    if (shuttingDown) {
      log.warn('shutdown.forced', { signal });
      process.exit(1);
    }

    shuttingDown = true;
    log.info('shutdown.start', { signal, job: currentJob?.id ?? null });
    for (const timer of timers) clearInterval(timer);
    // Aborting mid-job is safe: the job returns to 'queued' and another
    // worker starts it from the beginning. Partial output is overwritten.
    currentJob?.abort.abort();
  };

  process.on('SIGINT', () => stop('SIGINT'));
  process.on('SIGTERM', () => stop('SIGTERM'));
}

async function main(): Promise<void> {
  await mkdir(join(config.dataDir, 'results'), { recursive: true });
  await refreshDisposableList();

  const timers = startMaintenance();
  installShutdown(timers);

  log.info('worker.ready', {
    workerId: config.workerId,
    dataDir: config.dataDir,
    dnsServers: config.dnsServers.length > 0 ? config.dnsServers : 'system',
    dnsConcurrency: config.dnsConcurrency,
  });

  await workLoop();
  log.info('worker.stopped', { workerId: config.workerId });
  process.exit(0);
}

void main().catch((error: unknown) => {
  log.error('worker.crashed', { error: String(error) });
  process.exit(1);
});
