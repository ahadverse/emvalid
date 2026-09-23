import { DnsClient, type DnsOptions } from './dns.ts';
import { MemoryDomainCache, type DomainCache } from './cache.ts';
import type { DomainInfo } from './types.ts';

/**
 * Cache + DNS + in-flight deduplication, with a ceiling on how many queries
 * are open at once.
 *
 * The deduplication is not an optimisation, it is a correctness matter for
 * bulk: when five hundred workers hit gmail.com in the same tick, without it
 * we fire five hundred identical queries and get ourselves rate-limited by
 * our own resolver.
 */

export interface DomainResolverOptions extends DnsOptions {
  cache?: DomainCache;
  /** Simultaneous DNS queries. 500 is comfortable against local unbound. */
  concurrency?: number;
}

export class DomainResolver {
  readonly #dns: DnsClient;
  readonly #cache: DomainCache;
  readonly #inFlight = new Map<string, Promise<DomainInfo>>();
  readonly #concurrency: number;
  #active = 0;
  readonly #queue: Array<() => void> = [];

  readonly stats = { cacheHits: 0, dnsQueries: 0, coalesced: 0 };

  constructor(options: DomainResolverOptions = {}) {
    const { cache, concurrency, ...dns } = options;
    this.#dns = new DnsClient(dns);
    this.#cache = cache ?? new MemoryDomainCache();
    this.#concurrency = concurrency ?? 500;
  }

  async resolve(domain: string): Promise<DomainInfo> {
    const cached = await this.#cache.get(domain);
    if (cached !== null) {
      this.stats.cacheHits++;
      return cached;
    }

    const pending = this.#inFlight.get(domain);
    if (pending !== undefined) {
      this.stats.coalesced++;
      return pending;
    }

    const task = this.#lookup(domain);
    this.#inFlight.set(domain, task);

    try {
      return await task;
    } finally {
      this.#inFlight.delete(domain);
    }
  }

  async #lookup(domain: string): Promise<DomainInfo> {
    await this.#acquire();
    try {
      this.stats.dnsQueries++;
      const info = await this.#dns.lookupDomain(domain);
      await this.#cache.set(info);
      return info;
    } finally {
      this.#release();
    }
  }

  #acquire(): Promise<void> {
    if (this.#active < this.#concurrency) {
      this.#active++;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.#queue.push(() => {
        this.#active++;
        resolve();
      });
    });
  }

  #release(): void {
    this.#active--;
    this.#queue.shift()?.();
  }
}
