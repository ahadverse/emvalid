import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Worker configuration, read once at boot.
 *
 * Defaults are tuned for a single 4-core VPS, which is the whole deployment
 * target for now. The two that matter most are `dnsServers` and
 * `dnsConcurrency` — see the comments on each.
 */

function env(name: string): string | undefined {
  const value = process.env[name];
  return value === undefined || value.trim() === '' ? undefined : value.trim();
}

/**
 * The web app writes the upload and the worker writes the result, and the
 * download route refuses any path outside DATA_DIR. If the two processes
 * disagree about where that is, everything looks fine right up to the download,
 * which 404s or 410s on a file that exists a directory away.
 *
 * They disagree easily: `./data` means one thing from `apps/web` and another
 * from `apps/worker`. So a relative DATA_DIR is anchored at the repo root
 * rather than at whatever directory the process happened to start in, and the
 * paths written to the database are absolute.
 */
function dataDir(): string {
  const configured = env('DATA_DIR') ?? './data';
  if (isAbsolute(configured)) return configured;

  const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));
  return resolve(repoRoot, configured);
}

function num(name: string, fallback: number): number {
  const value = env(name);
  if (value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const config = {
  workerId: env('WORKER_ID') ?? `worker-${process.pid}`,

  /** Where uploads and result files live. Never inside the repo in production. */
  dataDir: dataDir(),

  /**
   * Point this at a local unbound/dnsmasq in production. Running a hundred
   * thousand queries a minute through a public resolver gets the VPS
   * rate-limited, and then DNS — not the network or the CPU — is what caps
   * the whole product's throughput. Empty means "use the system resolver",
   * which is fine on a laptop and wrong on a server.
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
} as const;
