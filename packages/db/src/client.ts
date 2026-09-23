import { Pool, type PoolConfig } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from './schema.ts';

/**
 * One pool per process, created on first use.
 *
 * Lazy matters more than it looks: Next.js imports this module while building
 * pages, long before any request needs a connection, and a worker imports it at
 * boot. Connecting at import time would mean a missing DATABASE_URL breaks the
 * build rather than the query, and would open a pool in processes that never
 * run one.
 */

export type Database = NodePgDatabase<typeof schema>;

export interface DatabaseHandle {
  pool: Pool;
  db: Database;
}

/**
 * Next.js reloads modules on every edit in dev. A module-level `let` would be
 * reset each time and leak a pool per save until Postgres refuses connections,
 * so the handle hangs off globalThis, which survives the reload.
 */
const HANDLE = Symbol.for('@ev/db.handle');

type GlobalWithHandle = typeof globalThis & { [HANDLE]?: DatabaseHandle };

function connectionString(): string {
  const url = process.env['DATABASE_URL'];
  if (url === undefined || url === '') {
    throw new Error('DATABASE_URL is not set — copy packages/db/.env.example and fill it in');
  }
  return url;
}

function poolMax(): number {
  const raw = process.env['DATABASE_POOL_MAX'];
  const parsed = raw === undefined ? Number.NaN : Number.parseInt(raw, 10);
  // The web app and the worker each hold a pool; a small default keeps their
  // sum under Postgres' 100-connection ceiling without anyone tuning anything.
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 10;
}

/**
 * Builds an unregistered handle. Tests and one-off scripts use this to talk to
 * a throwaway database without disturbing the process-wide singleton.
 */
export function createDatabase(config: string | PoolConfig = connectionString()): DatabaseHandle {
  const pool = new Pool(
    typeof config === 'string' ? { connectionString: config, max: poolMax() } : config,
  );

  // Without a listener an idle client that dies (a Postgres restart, a network
  // drop) emits 'error' on the pool, and an unhandled 'error' event takes the
  // whole process down. The pool discards the client on its own; we only have
  // to not crash.
  pool.on('error', (error) => {
    console.error('[db] idle client error', error);
  });

  return { pool, db: drizzle(pool, { schema }) };
}

export function getHandle(): DatabaseHandle {
  const global = globalThis as GlobalWithHandle;
  return (global[HANDLE] ??= createDatabase());
}

export function getDb(): Database {
  return getHandle().db;
}

export function getPool(): Pool {
  return getHandle().pool;
}

/** Ends the shared pool. Call from a worker's shutdown path, not from a request. */
export async function closeDatabase(): Promise<void> {
  const global = globalThis as GlobalWithHandle;
  const handle = global[HANDLE];
  if (handle === undefined) return;

  delete global[HANDLE];
  await handle.pool.end();
}
