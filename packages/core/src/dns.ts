import { Resolver } from 'node:dns/promises';
import { detectMxProvider } from './policy/mx-provider.ts';
import { isParkingNs } from './policy/parking.ts';
import type { DomainInfo } from './types.ts';

/**
 * Features 5-7 and 12 — everything we can learn about a domain from DNS.
 *
 * The one thing this file exists to get right is feature 7: telling
 * "this domain has no mail server" apart from "our resolver did not answer".
 * They arrive as errors that look almost identical, and confusing them is how
 * a verification tool ends up deleting good addresses during a network blip.
 * The first is a verdict. The second is a retry, and never a verdict.
 */

export interface DnsOptions {
  /**
   * Resolvers to query. On the VPS this points at a local unbound instance —
   * running a hundred thousand lookups through a public resolver gets you
   * rate-limited, and then DNS is the bottleneck instead of the network.
   */
  servers?: string[];
  /** Per-query timeout in ms. */
  timeout?: number;
  /** Retries inside the resolver before we call it a failure. */
  tries?: number;
}

/** Node's DNS error codes, split by what they actually mean for us. */
const NO_RECORDS = new Set(['ENODATA', 'ENOTFOUND']);
const TRANSIENT = new Set([
  'ESERVFAIL', 'ETIMEOUT', 'ETIMEDOUT', 'ECONNREFUSED', 'EREFUSED',
  'ECONNRESET', 'ENOTIMP', 'EFORMERR', 'ENOMEM', 'EBADRESP', 'ECANCELLED',
]);

export class DnsClient {
  #resolver: Resolver;

  constructor(options: DnsOptions = {}) {
    this.#resolver = new Resolver({
      timeout: options.timeout ?? 5000,
      tries: options.tries ?? 2,
    });
    if (options.servers !== undefined && options.servers.length > 0) {
      this.#resolver.setServers(options.servers);
    }
  }

  /**
   * One domain, one answer. Never throws — a DNS problem comes back as
   * `error` set and every other field left neutral, so the caller cannot
   * accidentally read a failure as "no mail server".
   */
  async lookupDomain(domain: string): Promise<DomainInfo> {
    const base: DomainInfo = {
      domain,
      mx: [],
      nullMx: false,
      hasAddressRecord: false,
      nxdomain: false,
      error: null,
      provider: null,
      parked: null,
      checkedAt: Date.now(),
    };

    // Feature 66. Always runs, independent of the MX/A outcome below and of
    // whether it succeeds — a failed NS lookup leaves `parked` at `null`
    // rather than touching `error`, so a bonus query that times out can never
    // turn an otherwise-good answer into a retry (invariant 2).
    const parked = await this.#resolveParked(domain);

    const mx = await this.#resolveMx(domain);

    if (mx.error !== null) return { ...base, error: mx.error, parked };

    if (mx.hosts.length > 0) {
      // RFC 7505: a single MX of "." means the domain accepts no mail at all.
      // It is an explicit statement, not an absence — the strongest
      // undeliverable signal DNS can give us.
      if (mx.hosts.length === 1 && (mx.hosts[0] === '.' || mx.hosts[0] === '')) {
        return { ...base, nullMx: true, parked };
      }
      return { ...base, mx: mx.hosts, provider: detectMxProvider(mx.hosts), parked };
    }

    // Feature 6 — no MX. RFC 5321 §5.1 says fall back to the address record:
    // a domain with an A record and no MX still takes mail, at that host.
    // Plenty of small business domains are set up exactly this way.
    const address = await this.#resolveAddress(domain);

    if (address.error !== null) return { ...base, error: address.error, parked };

    return {
      ...base,
      hasAddressRecord: address.found,
      nxdomain: address.nxdomain,
      parked,
    };
  }

  /**
   * `null` on any failure — this is a bonus signal, not load-bearing the way
   * MX/A are, so a broken resolver here must never look like a broken
   * resolver for the domain as a whole.
   */
  async #resolveParked(domain: string): Promise<boolean | null> {
    try {
      const hosts = await this.#resolver.resolveNs(domain);
      return isParkingNs(hosts);
    } catch {
      return null;
    }
  }

  async #resolveMx(
    domain: string,
  ): Promise<{ hosts: string[]; error: DomainInfo['error'] }> {
    try {
      const records = await this.#resolver.resolveMx(domain);
      const hosts = records
        .slice()
        .sort((a, b) => a.priority - b.priority)
        .map((record) => record.exchange.toLowerCase().replace(/\.$/, ''));
      return { hosts, error: null };
    } catch (error) {
      const code = errorCode(error);
      if (NO_RECORDS.has(code)) return { hosts: [], error: null };
      return { hosts: [], error: classifyError(code) };
    }
  }

  async #resolveAddress(
    domain: string,
  ): Promise<{ found: boolean; nxdomain: boolean; error: DomainInfo['error'] }> {
    try {
      const addresses = await this.#resolver.resolve4(domain);
      if (addresses.length > 0) return { found: true, nxdomain: false, error: null };
    } catch (error) {
      const code = errorCode(error);
      if (!NO_RECORDS.has(code)) {
        return { found: false, nxdomain: false, error: classifyError(code) };
      }
      // ENOTFOUND here is NXDOMAIN — the name itself does not exist. But a
      // v6-only host would also land here on resolve4, so check AAAA before
      // calling it.
      if (code === 'ENOTFOUND') {
        const v6 = await this.#resolve6(domain);
        if (v6.error !== null) return { found: false, nxdomain: false, error: v6.error };
        if (v6.found) return { found: true, nxdomain: false, error: null };
        return { found: false, nxdomain: true, error: null };
      }
    }

    const v6 = await this.#resolve6(domain);
    if (v6.error !== null) return { found: false, nxdomain: false, error: v6.error };
    return { found: v6.found, nxdomain: false, error: null };
  }

  async #resolve6(domain: string): Promise<{ found: boolean; error: DomainInfo['error'] }> {
    try {
      const addresses = await this.#resolver.resolve6(domain);
      return { found: addresses.length > 0, error: null };
    } catch (error) {
      const code = errorCode(error);
      if (NO_RECORDS.has(code)) return { found: false, error: null };
      return { found: false, error: classifyError(code) };
    }
  }
}

function errorCode(error: unknown): string {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code: unknown }).code)
    : 'UNKNOWN';
}

function classifyError(code: string): NonNullable<DomainInfo['error']> {
  if (code === 'ETIMEOUT' || code === 'ETIMEDOUT') return 'timeout';
  if (TRANSIENT.has(code)) return 'servfail';
  return 'other';
}

/** True when the domain can take mail by either route. */
export function acceptsMail(info: DomainInfo): boolean {
  return !info.nullMx && (info.mx.length > 0 || info.hasAddressRecord);
}
