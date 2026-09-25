import { eq, sql } from 'drizzle-orm';
import type { DomainCache, DomainInfo } from '@ev/core';
import { getDb, type Database } from './client.ts';
import { domainCache, type DomainCacheRow } from './schema.ts';

/**
 * Feature 22 — the shared, persistent half of the domain cache.
 *
 * `MemoryDomainCache` in @ev/core dies with the process; this one is what makes
 * the second job faster than the first, and what lets ten workers benefit from
 * one worker's DNS lookups. Put the two behind `TieredDomainCache` and the
 * memory layer absorbs the gmail.com-shaped hot spot while this one carries the
 * long tail.
 */

/** MX records move rarely. Thirty days is the same figure core's memory cache uses. */
export const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface PostgresDomainCacheOptions {
  db?: Database;
  ttlMs?: number;
}

/** Pure: is a row still within its TTL? */
export function isFresh(checkedAt: Date, ttlMs: number, now: number = Date.now()): boolean {
  return now - checkedAt.getTime() <= ttlMs;
}

/**
 * Pure. A row can only exist for a domain we actually resolved, so `error` is
 * always null coming out — see `set` for why.
 */
export function rowToDomainInfo(row: DomainCacheRow): DomainInfo {
  return {
    domain: row.domain,
    mx: row.mx,
    nullMx: row.nullMx,
    hasAddressRecord: row.hasAddressRecord,
    nxdomain: row.nxdomain,
    error: null,
    provider: row.provider,
    // A row from before migration 0004 reads back NULL here already — the
    // column has no default — so this is a straight pass-through, not a
    // translation: `null` means "not checked" on both sides.
    parked: row.parked,
    checkedAt: row.checkedAt.getTime(),
  };
}

/** Pure: `DomainInfo` carries Unix ms, the column carries timestamptz. */
export function domainInfoToRow(info: DomainInfo): DomainCacheRow {
  return {
    domain: info.domain,
    mx: [...info.mx],
    nullMx: info.nullMx,
    hasAddressRecord: info.hasAddressRecord,
    nxdomain: info.nxdomain,
    provider: info.provider,
    parked: info.parked,
    checkedAt: new Date(info.checkedAt),
  };
}

/**
 * The bulk read, as a query. `= ANY($1)` sends the whole domain list as one
 * parameter; `IN ($1, $2, ... $5000)` would send five thousand, and Postgres
 * stops at 65535 per statement — a limit a single chunk of a large job can
 * genuinely reach.
 *
 * The TTL is applied in the WHERE clause rather than after the rows arrive, so
 * stale rows never cross the wire.
 */
export function freshDomainsQuery(db: Database, domains: readonly string[], ttlMs: number) {
  return db
    .select()
    .from(domainCache)
    .where(
      sql`${domainCache.domain} = ANY(${[...domains]})
            AND ${domainCache.checkedAt} > now() - ${`${Math.max(0, Math.round(ttlMs))} milliseconds`}::interval`,
    );
}

export class PostgresDomainCache implements DomainCache {
  readonly #db: Database;
  readonly #ttlMs: number;
  #errors = 0;
  #lastWarnAt = 0;

  constructor(options: PostgresDomainCacheOptions = {}) {
    this.#db = options.db ?? getDb();
    this.#ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  }

  get ttlMs(): number {
    return this.#ttlMs;
  }

  async get(domain: string): Promise<DomainInfo | null> {
    return this.#tolerate('get', null, async () => {
      const [row] = await this.#db
        .select()
        .from(domainCache)
        .where(eq(domainCache.domain, domain))
        .limit(1);

      if (row === undefined) return null;
      // Expiry is checked here rather than deleting the row: a stale row still
      // costs nothing, and the next `set` overwrites it in place.
      if (!isFresh(row.checkedAt, this.#ttlMs)) return null;
      return rowToDomainInfo(row);
    });
  }

  /**
   * One query for the whole batch. A bulk job asks about thousands of domains
   * per chunk, and a loop would turn a single round trip into thousands.
   */
  async getMany(domains: readonly string[]): Promise<Map<string, DomainInfo>> {
    const found = new Map<string, DomainInfo>();
    if (domains.length === 0) return found;

    return this.#tolerate('getMany', found, async () => {
      for (const row of await freshDomainsQuery(this.#db, domains, this.#ttlMs)) {
        found.set(row.domain, rowToDomainInfo(row));
      }
      return found;
    });
  }

  /**
   * A DNS failure is not an answer. Caching it would freeze a temporary network
   * problem into every result for the next thirty days — and unlike the memory
   * cache, this one would survive the restart that fixed the problem. Core's
   * `MemoryDomainCache` refuses the same rows for the same reason.
   */
  async set(info: DomainInfo): Promise<void> {
    if (info.error !== null) return;
    await this.setMany([info]);
  }

  /** Bulk upsert, so a chunk's worth of fresh lookups costs one statement. */
  async setMany(infos: readonly DomainInfo[]): Promise<void> {
    const rows = infos.filter((info) => info.error === null).map(domainInfoToRow);
    if (rows.length === 0) return;

    await this.#tolerate('setMany', undefined, () => this.#upsert(rows));
  }

  async #upsert(rows: DomainCacheRow[]): Promise<void> {
    await this.#db
      .insert(domainCache)
      .values(rows)
      .onConflictDoUpdate({
        target: domainCache.domain,
        set: {
          mx: sql`excluded.mx`,
          nullMx: sql`excluded.null_mx`,
          hasAddressRecord: sql`excluded.has_address_record`,
          nxdomain: sql`excluded.nxdomain`,
          provider: sql`excluded.provider`,
          parked: sql`excluded.parked`,
          checkedAt: sql`excluded.checked_at`,
        },
        // A concurrent writer may have landed a newer lookup while ours was in
        // flight; overwriting it would move `checkedAt` backwards and shorten
        // the cache lifetime of a perfectly good row.
        setWhere: sql`${domainCache.checkedAt} < excluded.checked_at`,
      });
  }

  /**
   * A cache that throws is worse than no cache at all.
   *
   * Everything in here is an optimisation: a miss costs a DNS lookup, which is
   * exactly what we would have done anyway. So when Postgres is unreachable —
   * restarting, out of connections, wrong password in a fresh deployment — the
   * verification still has to work. Letting the error escape would take down
   * the single-address API and every bulk job for the sake of a lookup we can
   * simply repeat.
   *
   * Failures are surfaced through `errors` and a throttled warning rather than
   * silence, because a permanently broken cache is a real problem: it just is
   * not an urgent one, and a bulk job would otherwise log the same line ten
   * thousand times.
   */
  async #tolerate<T>(operation: string, fallback: T, run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      this.#errors++;
      const now = Date.now();
      if (now - this.#lastWarnAt > 60_000) {
        this.#lastWarnAt = now;
        console.warn(
          `[@ev/db] domain cache ${operation} failed (${this.#errors} total); ` +
            `continuing without cache: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      return fallback;
    }
  }

  /** How many cache operations have failed. Zero on a healthy instance. */
  get errors(): number {
    return this.#errors;
  }
}
