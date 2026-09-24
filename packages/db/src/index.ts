/**
 * @ev/db — Postgres, and everything that has to survive a restart.
 *
 * Three jobs live here and they share one database on purpose: job metadata,
 * the work queue, and the persistent domain cache. There is no Redis. A single
 * Postgres doing `SELECT ... FOR UPDATE SKIP LOCKED` is a perfectly good queue
 * at this scale, and one fewer moving part on a five-dollar VPS is worth more
 * than the throughput a broker would add.
 *
 * The rule this package exists to enforce: **email addresses never become
 * rows.** A ten-million-row job is a file on disk; what lands in Postgres is
 * one `jobs` row and a handful of counters.
 */

export * from './schema.ts';
export {
  closeDatabase,
  createDatabase,
  getDb,
  getHandle,
  getPool,
  type Database,
  type DatabaseHandle,
} from './client.ts';

export {
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_RETENTION_DAYS,
  JobQueue,
  claimQuery,
  intervalLiteral,
  reclaimStalledQuery,
  retentionExpiry,
  type EnqueueInput,
  type FailOptions,
  type JobQueueOptions,
  type ReclaimReport,
} from './queue.ts';

export {
  DEFAULT_TTL_MS,
  PostgresDomainCache,
  domainInfoToRow,
  freshDomainsQuery,
  isFresh,
  rowToDomainInfo,
  type PostgresDomainCacheOptions,
} from './domain-cache.ts';

export {
  daysAgo,
  deleteExpiredJobs,
  purgeStaleDomainCache,
  removeFiles,
  type FileRemovalResult,
  type RetentionLogger,
  type RetentionOptions,
  type RetentionResult,
} from './retention.ts';

export {
  API_KEY_PREFIX_LENGTH,
  apiKeyPrefix,
  createApiKey,
  generateApiKey,
  hashApiKey,
  listApiKeys,
  revokeApiKey,
  touchApiKey,
  verifyApiKey,
  type CreatedApiKey,
} from './api-keys.ts';

export {
  EmailTakenError,
  countActiveAdmins,
  createUser,
  findUserByEmail,
  findUserById,
  firstUser,
  listUsersForAdmin,
  normalizeEmail,
  platformStats,
  setPasswordHash,
  setUserRole,
  setUserStatus,
  type AdminUserRow,
  type CreateUserInput,
  type PlatformStats,
} from './users.ts';

export {
  SESSION_TTL_MS,
  countActiveSessions,
  createSession,
  deleteSession,
  deleteUserSessions,
  findSessionUser,
  generateSessionToken,
  hashSessionToken,
  purgeExpiredSessions,
  type CreatedSession,
  type SessionUser,
} from './sessions.ts';

export {
  InsufficientCreditsError,
  consumeCredits,
  consumeUpTo,
  creditBalance,
  grantCredits,
  listLedger,
  reconcile,
  type GrantOptions,
} from './credits.ts';

export {
  OrderNotPendingError,
  cancelOrder,
  extendSubscription,
  findOrder,
  findSubscription,
  listOrders,
  listOrdersForAdmin,
  markOrderPaid,
  placeOrder,
  type AdminOrderRow,
  type PlaceOrderInput,
} from './orders.ts';

export { migrate, type MigrationResult } from './migrate.ts';

import { JobQueue } from './queue.ts';

let defaultQueue: JobQueue | null = null;

/**
 * The process-wide queue.
 *
 * A function rather than an exported instance because `new JobQueue()` opens
 * the connection pool: as a module-level constant it would fire on import, and
 * every Next.js route that so much as re-exports a type from this package
 * would connect to Postgres whether or not it ever runs a query.
 */
export function getQueue(): JobQueue {
  defaultQueue ??= new JobQueue();
  return defaultQueue;
}
