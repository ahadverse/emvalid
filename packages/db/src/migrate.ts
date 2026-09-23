import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PoolClient } from 'pg';
import { getPool } from './client.ts';

/**
 * Migration runner. Plain SQL files, applied in filename order, each in its
 * own transaction.
 *
 * Hand-rolled rather than drizzle-kit's runner for one reason: an advisory
 * lock. Two workers and a web instance can all boot at the same moment on a
 * single VPS, and without the lock they race to run the same `CREATE TABLE`.
 * Postgres would arbitrate that with a duplicate-object error at exactly the
 * moment the service is coming up.
 *
 * Applied files are recorded with a checksum. Editing a migration that has
 * already run is a mistake that otherwise shows up much later as a schema that
 * does not match anybody's expectations, so it is refused here instead.
 */

/** Any 64-bit constant; it only has to be the same in every process. */
const LOCK_ID = 0x65_76_6d_69; // "evmi"

export interface MigrationResult {
  applied: string[];
  skipped: string[];
}

export async function migrate(directory = defaultDirectory()): Promise<MigrationResult> {
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_ID]);
    await ensureTable(client);

    const applied = await appliedMigrations(client);
    const files = (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort();

    const result: MigrationResult = { applied: [], skipped: [] };

    for (const name of files) {
      const sql = await readFile(join(directory, name), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const previous = applied.get(name);

      if (previous !== undefined) {
        if (previous !== checksum) {
          throw new Error(
            `Migration ${name} has changed since it was applied. ` +
              'Add a new migration instead of editing an applied one.',
          );
        }
        result.skipped.push(name);
        continue;
      }

      // Each file gets its own transaction: a failure leaves every earlier
      // migration applied and this one entirely undone, which is the only
      // state a human can reason about at 3am.
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          'INSERT INTO _migrations (name, checksum) VALUES ($1, $2)',
          [name, checksum],
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${name} failed: ${String(error)}`, { cause: error });
      }

      result.applied.push(name);
    }

    return result;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]).catch(() => {});
    client.release();
  }
}

async function ensureTable(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name       text PRIMARY KEY,
      checksum   text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

async function appliedMigrations(client: PoolClient): Promise<Map<string, string>> {
  const { rows } = await client.query<{ name: string; checksum: string }>(
    'SELECT name, checksum FROM _migrations',
  );
  return new Map(rows.map((row) => [row.name, row.checksum]));
}

function defaultDirectory(): string {
  // Resolved from this module rather than cwd: the worker, the web app and the
  // CLI all run from different directories and all need the same files.
  return join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
}
