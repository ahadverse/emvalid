import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Worker configuration, read once at boot.
 *
 * Defaults are tuned for one small always-on instance, which is the whole
 * deployment target: a Render background worker beside the web app on Vercel.
 * The two settings that matter most are `dnsServers` and `dnsConcurrency` —
 * see the comments on each.
 */

function env(name: string): string | undefined {
  const value = process.env[name];
  return value === undefined || value.trim() === '' ? undefined : value.trim();
}

/**
 * Only the local storage driver uses this, and only on a laptop.
 *
 * A relative `DATA_DIR` is anchored at the repo root rather than at whatever
 * directory the process happened to start in, because `./data` otherwise means
 * `apps/web/data` to the web app and `apps/worker/data` here — a mismatch that
 * stays invisible until a download 410s on a file that exists one directory
 * over. `apps/web/next.config.ts` does the same, and both write the absolute
 * value back into the environment, which is where @ev/storage reads it from.
 */
function storageRoot(): string {
  const configured = env('DATA_DIR') ?? './data';
  if (isAbsolute(configured)) return configured;

  return resolve(fileURLToPath(new URL('../../..', import.meta.url)), configured);
}

process.env['DATA_DIR'] = storageRoot();

function num(name: string, fallback: number): number {
  const value = env(name);
  if (value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const config = {
  workerId: env('WORKER_ID') ?? `worker-${process.pid}`,

  /**
   * Scratch space for the job in hand, and nothing else.
   *
   * @ev/pipeline reads and writes paths — it streams through files far larger
   * than memory, and handing it a network stream would make a dropped
   * connection halfway an unrecoverable job. So the input is fetched here, the
   * result is written here, and both are deleted as soon as the result is in
   * the bucket. Nothing in here survives a restart, and nothing needs to: the
   * durable copy is the object store.
   */
  scratchDir: env('SCRATCH_DIR') ?? join(tmpdir(), 'emvalid-worker'),

  /**
   * Downloads that are worth keeping between jobs but not worth storing — at
   * the moment only the disposable-domain list.
   *
   * Separate from `scratchDir` because that one is emptied at boot: a cache
   * wiped every restart is not a cache. Losing this on a redeploy is fine, it
   * refetches; losing it on every crash-loop restart would mean a worker that
   * boots without internet starts with nothing.
   */
  cacheDir: env('CACHE_DIR') ?? join(tmpdir(), 'emvalid-cache'),

  /**
   * Point this at a local unbound/dnsmasq if the host allows one. Running a
   * hundred thousand queries a minute through a public resolver gets the
   * instance rate-limited, and then DNS — not the network or the CPU — is what
   * caps the whole product's throughput. Empty means "use the system
   * resolver", which is fine on a laptop and wrong on a server.
   */
  dnsServers: (env('DNS_SERVERS') ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  dnsTimeoutMs: num('DNS_TIMEOUT_MS', 5000),
  dnsTries: num('DNS_TRIES', 2),

  /** Simultaneous DNS queries. Comfortable against local unbound; drop it hard if you are on a public resolver. */
  dnsConcurrency: num('DNS_CONCURRENCY', 500),

  /** Rows read and validated per batch. Memory stays flat regardless of file size. */
  batchSize: num('BATCH_SIZE', 1000),

  /** Hot in-process cache in front of Postgres. ~100k domains is a few MB. */
  memoryCacheEntries: num('MEMORY_CACHE_ENTRIES', 100_000),
  domainCacheTtlDays: num('DOMAIN_CACHE_TTL_DAYS', 30),

  /** How long to sleep when the queue is empty. */
  idlePollMs: num('IDLE_POLL_MS', 2000),

  /**
   * A job whose worker died stays 'running' forever unless someone puts it
   * back. This is how long we wait before assuming the worker is gone.
   */
  stalledAfterMs: num('STALLED_AFTER_MS', 5 * 60_000),

  /**
   * How often the retention sweep runs — feature 24.
   *
   * There is deliberately no "retention days" knob here: a job's `expiresAt`
   * is stamped once at enqueue by the web app (`DATA_RETENTION_DAYS`), and the
   * worker only deletes what is already past it. A second setting on this side
   * would look like it controlled retention while changing nothing.
   */
  retentionIntervalMs: num('RETENTION_INTERVAL_MS', 60 * 60_000),

  /**
   * A health endpoint, opened only when the host asks for one by setting PORT.
   *
   * A Render background worker does not, and gets none. A Render *web* service
   * does, and is killed at deploy if nothing ever binds the port — which is
   * how this worker can also run on the free tier, where background workers do
   * not exist. Nothing else depends on it.
   */
  healthPort: (() => {
    const raw = env('PORT');
    if (raw === undefined) return null;

    const port = Number(raw);
    return Number.isInteger(port) && port > 0 && port < 65_536 ? port : null;
  })(),
} as const;
