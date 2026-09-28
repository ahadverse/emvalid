import { createServer } from 'node:http';
import { mkdir, rm } from 'node:fs/promises';
import { extname, join } from 'node:path';
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
import { processFile, resultFileExtension, type ResultFormat } from '@ev/pipeline';
import { getStorage, isStorageKey, resultKey } from '@ev/storage';
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
 *
 * It no longer shares a disk with the web app — that one runs on Vercel, this
 * one on Render — so a job arrives as a key rather than a path. The file is
 * fetched into scratch space, processed exactly as before, and the result goes
 * back to the bucket before the job is marked complete. See `runJob`.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

const queue = getQueue();
const storage = getStorage();

/** What the result object is served as when the browser is redirected to it. */
const RESULT_CONTENT_TYPES: Record<ResultFormat, string> = {
  csv: 'text/csv; charset=utf-8',
  json: 'application/json; charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

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

  /*
   * Scratch, not storage. @ev/pipeline reads and writes paths because it
   * streams through files far larger than memory; a network stream in the
   * middle of that would turn a dropped connection at row nine million into an
   * unrecoverable job. So the input is fetched down, the result is written
   * locally, and the bucket sees each of them exactly once. The whole
   * directory goes in `finally`.
   */
  const workspace = join(config.scratchDir, job.id);
  const inputPath = join(workspace, `input${extname(job.inputPath)}`);

  const extension = resultFileExtension(job.resultFormat);
  const outputPath = join(workspace, `result${extension}`);
  // Derived from the job id rather than read off the row: a retry must
  // overwrite the half-written result of the attempt before it, not leave it
  // orphaned in the bucket under a key nothing will ever look for again.
  const outputKey = resultKey(job.id, extension);

  await mkdir(workspace, { recursive: true });

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
    await storage.fetchToFile(job.inputPath, inputPath);

    const { summary, column, format } = await processFile({
      inputPath,
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

    /*
     * Uploaded before the row says 'completed', and that order is the whole
     * point. Mark it complete first and a crash in between leaves a job the
     * dashboard offers a download for and the bucket has never heard of. This
     * way the worst case is a result object whose job is still 'running',
     * which the retry overwrites.
     */
    await storage.sendFile(outputKey, outputPath, {
      contentType: RESULT_CONTENT_TYPES[job.resultFormat],
    });

    await queue.complete(job.id, summary, { outputPath: outputKey, processedRows });

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
    // Someone else's list, sitting on a container's disk with nothing left to
    // read it. It goes whether the job succeeded, failed or was requeued.
    await rm(workspace, { recursive: true, force: true }).catch((error: unknown) => {
      log.warn('job.scratch_cleanup_failed', { jobId: job.id, error: String(error) });
    });
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
 * How the retention sweep destroys one object.
 *
 * The `isStorageKey` branch is about rows written before the two halves stopped
 * sharing a disk: those hold an absolute path on a machine that no longer
 * exists, so there is nothing to delete and never will be. Reporting that as a
 * failure would make the sweep keep the row and retry it every hour forever, so
 * it is reported as gone — which, as far as any bucket is concerned, it is.
 */
async function removeStoredObject(key: string): Promise<void> {
  if (!isStorageKey(key)) {
    log.warn('retention.unremovable_key', { key });
    return;
  }
  await storage.remove(key);
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

      // @ev/db does not know what a bucket is, so the sweep is handed the one
      // thing it needs: how to destroy an object.
      const retention = await deleteExpiredJobs(removeStoredObject, {
        logger: { info: log.info },
      });
      if (retention.jobs > 0) {
        log.info('retention.deleted', { jobs: retention.jobs, objects: retention.objects.deleted });
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

/**
 * A health endpoint, and only when the host asks for one by setting PORT.
 *
 * A Render background worker does not set it and gets no server. A Render web
 * service does, and is killed at deploy if nothing binds the port — which is
 * what lets this same process run on the free tier, where background workers
 * are not offered. It reports liveness, not readiness: the honest answer to
 * "is the queue healthy" lives in the jobs table, not in this process.
 */
function startHealthServer(): void {
  if (config.healthPort === null) return;

  const server = createServer((request, response) => {
    if (request.url === '/health' || request.url === '/') {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ status: 'ok', workerId: config.workerId }));
      return;
    }
    response.writeHead(404).end();
  });

  // Never a reason to take the worker down with it.
  server.on('error', (error) => log.error('health.failed', { error: String(error) }));
  server.listen(config.healthPort, () => log.info('health.listening', { port: config.healthPort }));
  server.unref();
}

async function main(): Promise<void> {
  // Anything in here belongs to a job that died with the last process. There
  // is nothing to resume from it — the durable copy is in the bucket — and it
  // is somebody's list, so it goes before the loop starts.
  await rm(config.scratchDir, { recursive: true, force: true }).catch(() => undefined);
  await mkdir(config.scratchDir, { recursive: true });

  await refreshDisposableList();

  startHealthServer();
  const timers = startMaintenance();
  installShutdown(timers);

  log.info('worker.ready', {
    workerId: config.workerId,
    storage: storage.kind,
    scratchDir: config.scratchDir,
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
