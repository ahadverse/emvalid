import { classify, parseEmail, type ParsedEmail } from './classify.ts';
import { DomainResolver, type DomainResolverOptions } from './domain-resolver.ts';
import { explain, type Check } from './explain.ts';
import type { EmailResult } from './types.ts';

/**
 * The engine's front door.
 *
 * Single-address checks go through `validate`. Bulk goes through
 * `validateMany`, which does the one thing that makes bulk viable: parse
 * everything first, collect the distinct domains, resolve those, then classify.
 * A million addresses on a hundred thousand domains means a hundred thousand
 * lookups, not a million.
 */

export interface ValidatorOptions extends DomainResolverOptions {
  /** Skip DNS entirely — syntax and policy only. Fast, much weaker. */
  skipDns?: boolean;
}

/** A verdict plus the working behind it. See explain.ts. */
export interface InspectedEmail {
  result: EmailResult;
  checks: Check[];
}

export class EmailValidator {
  readonly resolver: DomainResolver;
  readonly #skipDns: boolean;

  constructor(options: ValidatorOptions = {}) {
    const { skipDns, ...resolverOptions } = options;
    this.resolver = new DomainResolver(resolverOptions);
    this.#skipDns = skipDns ?? false;
  }

  async validate(input: string): Promise<EmailResult> {
    const parsed = parseEmail(input);
    return classify(parsed, await this.#domainFor(parsed));
  }

  /**
   * Same work as `validate`, and it also keeps the audit trail.
   *
   * Separate method rather than an option because of who calls what: bulk
   * calls `validate` ten million times and must never pay for prose it throws
   * away, while the one-address view wants every finding. No extra DNS — the
   * checks are built from signals the classification already had in hand.
   */
  async inspect(input: string): Promise<InspectedEmail> {
    const parsed = parseEmail(input);
    const domain = await this.#domainFor(parsed);
    return { result: classify(parsed, domain), checks: explain(parsed, domain) };
  }

  /**
   * Order in equals order out, so a caller can zip results back onto their
   * original rows without carrying an id around.
   */
  async validateMany(inputs: readonly string[]): Promise<EmailResult[]> {
    return this.classifyParsed(inputs.map(parseEmail));
  }

  /**
   * Same as `validateMany`, for a caller that has already parsed.
   *
   * The bulk pipeline needs the canonical form before validation to drop
   * duplicates, so it parses first. Handing the parsed rows back in avoids
   * parsing all ten million of them a second time, and keeps every decision
   * about when DNS runs inside this class where it belongs.
   */
  async classifyParsed(parsed: readonly ParsedEmail[]): Promise<EmailResult[]> {
    const domains = new Set<string>();
    for (const item of parsed) {
      if (this.#needsDns(item)) domains.add(item.parts!.domain);
    }

    // The resolver handles its own concurrency ceiling and coalescing, so
    // firing all of them at once is safe and keeps the pipe full.
    const resolved = new Map(
      await Promise.all(
        [...domains].map(async (domain) => [domain, await this.resolver.resolve(domain)] as const),
      ),
    );

    return parsed.map((item) =>
      classify(item, this.#needsDns(item) ? resolved.get(item.parts!.domain) ?? null : null),
    );
  }

  /** True when this validator was told to skip DNS entirely. */
  get skipsDns(): boolean {
    return this.#skipDns;
  }

  async #domainFor(parsed: ParsedEmail) {
    return this.#needsDns(parsed) ? this.resolver.resolve(parsed.parts!.domain) : null;
  }

  /** No point resolving a domain we already rejected on syntax. */
  #needsDns(parsed: ParsedEmail): boolean {
    return !this.#skipDns && parsed.syntaxError === null && parsed.parts !== null;
  }
}

/**
 * Feature 4 — alias-aware duplicate removal.
 *
 * Keyed on the canonical form, so `J.Doe+news@gmail.com` and `jdoe@gmail.com`
 * collapse to one. Holds only a hash set of canonical strings, which is what
 * lets it run over a ten-million-row file without the addresses themselves
 * ever being held in memory.
 */
export class Deduplicator {
  readonly #seen = new Set<string>();
  #duplicates = 0;

  /** True the first time a mailbox is seen, false for every repeat. */
  accept(canonical: string | null): boolean {
    if (canonical === null) return true; // unparseable rows are never merged
    if (this.#seen.has(canonical)) {
      this.#duplicates++;
      return false;
    }
    this.#seen.add(canonical);
    return true;
  }

  get uniqueCount(): number {
    return this.#seen.size;
  }

  get duplicateCount(): number {
    return this.#duplicates;
  }
}
