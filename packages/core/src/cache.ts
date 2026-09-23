import type { DomainInfo } from './types.ts';

/**
 * Feature 22 — domain-level cache. This is the single reason the tool is fast.
 *
 * Ten million addresses are only about a hundred thousand distinct domains,
 * and half of those are gmail.com. Cache the domain and the DNS stage very
 * nearly disappears; the more jobs run, the warmer it gets. Skip it and every
 * job re-asks the internet what it already knows.
 *
 * The interface is deliberately tiny so the platform can back it with a
 * Postgres table (and Redis later) while the engine stays unaware.
 */
export interface DomainCache {
  get(domain: string): Promise<DomainInfo | null>;
  set(info: DomainInfo): Promise<void>;
  /** Batched read. Default implementations may just loop. */
  getMany?(domains: readonly string[]): Promise<Map<string, DomainInfo>>;
}

export interface MemoryCacheOptions {
  /** 30 days for real answers — MX records move rarely. */
  ttlMs?: number;
  maxEntries?: number;
}

const DEFAULT_TTL = 30 * 24 * 60 * 60 * 1000;

/**
 * In-process LRU. Used on its own in development, and as the hot layer in
 * front of the Postgres cache in production — a worker chewing through one
 * file hits the same few thousand domains over and over.
 */
export class MemoryDomainCache implements DomainCache {
  readonly #entries = new Map<string, DomainInfo>();
  readonly #ttlMs: number;
  readonly #maxEntries: number;

  constructor(options: MemoryCacheOptions = {}) {
    this.#ttlMs = options.ttlMs ?? DEFAULT_TTL;
    this.#maxEntries = options.maxEntries ?? 100_000;
  }

  async get(domain: string): Promise<DomainInfo | null> {
    const entry = this.#entries.get(domain);
    if (entry === undefined) return null;

    if (Date.now() - entry.checkedAt > this.#ttlMs) {
      this.#entries.delete(domain);
      return null;
    }

    // Re-insert to move it to the end — Map keeps insertion order, which is
    // all the LRU bookkeeping we need.
    this.#entries.delete(domain);
    this.#entries.set(domain, entry);
    return entry;
  }

  async set(info: DomainInfo): Promise<void> {
    // A DNS failure is not an answer. Caching it would freeze a temporary
    // network problem into the results for the next thirty days.
    if (info.error !== null) return;

    this.#entries.delete(info.domain);
    this.#entries.set(info.domain, info);

    if (this.#entries.size > this.#maxEntries) {
      const oldest = this.#entries.keys().next();
      if (!oldest.done) this.#entries.delete(oldest.value);
    }
  }

  async getMany(domains: readonly string[]): Promise<Map<string, DomainInfo>> {
    const found = new Map<string, DomainInfo>();
    for (const domain of domains) {
      const entry = await this.get(domain);
      if (entry !== null) found.set(domain, entry);
    }
    return found;
  }

  get size(): number {
    return this.#entries.size;
  }

  clear(): void {
    this.#entries.clear();
  }
}

/**
 * Chains caches — memory first, then the shared store. A hit in the slow
 * layer is promoted into the fast one.
 */
export class TieredDomainCache implements DomainCache {
  readonly #layers: DomainCache[];

  constructor(...layers: DomainCache[]) {
    this.#layers = layers;
  }

  async get(domain: string): Promise<DomainInfo | null> {
    for (let i = 0; i < this.#layers.length; i++) {
      const layer = this.#layers[i];
      if (layer === undefined) continue;

      const entry = await layer.get(domain);
      if (entry !== null) {
        for (let j = 0; j < i; j++) await this.#layers[j]?.set(entry);
        return entry;
      }
    }
    return null;
  }

  async set(info: DomainInfo): Promise<void> {
    await Promise.all(this.#layers.map((layer) => layer.set(info)));
  }
}
