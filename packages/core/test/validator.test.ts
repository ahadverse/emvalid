import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MemoryDomainCache } from '../src/cache.ts';
import { Deduplicator, EmailValidator } from '../src/validator.ts';
import { SummaryBuilder } from '../src/summary.ts';
import { acceptsMail } from '../src/dns.ts';
import type { DomainInfo } from '../src/types.ts';

function info(domain: string, overrides: Partial<DomainInfo> = {}): DomainInfo {
  return {
    domain,
    mx: [`mail.${domain}`],
    nullMx: false,
    hasAddressRecord: false,
    nxdomain: false,
    error: null,
    provider: 'other',
    checkedAt: Date.now(),
    ...overrides,
  };
}

/**
 * Every test here pre-seeds the cache so the resolver never reaches the
 * network. A unit test that depends on DNS is a test that fails on a plane.
 */
async function seeded(entries: DomainInfo[]): Promise<EmailValidator> {
  const cache = new MemoryDomainCache();
  for (const entry of entries) await cache.set(entry);
  return new EmailValidator({ cache });
}

describe('EmailValidator', () => {
  it('validates a single address against cached domain data', async () => {
    const validator = await seeded([
      info('gmail.com', { mx: ['gmail-smtp-in.l.google.com'], provider: 'google' }),
    ]);

    const result = await validator.validate('Ahad@Gmail.com');
    assert.equal(result.normalized, 'ahad@gmail.com');
    assert.equal(result.status, 'unknown');
    assert.equal(result.flags.mxProvider, 'google');
    assert.equal(validator.resolver.stats.cacheHits, 1);
    assert.equal(validator.resolver.stats.dnsQueries, 0);
  });

  it('returns results in input order', async () => {
    const validator = await seeded([info('a.com'), info('b.com')]);
    const inputs = ['one@a.com', 'bad', 'three@b.com', 'info@a.com'];

    const results = await validator.validateMany(inputs);
    assert.deepEqual(results.map((r) => r.input), inputs);
    assert.equal(results[1]?.status, 'undeliverable');
    assert.equal(results[3]?.reason, 'role_account');
  });

  it('resolves each domain once no matter how many addresses use it', async () => {
    const validator = await seeded([info('shared.com')]);
    await validator.validateMany(
      Array.from({ length: 500 }, (_, i) => `user${i}@shared.com`),
    );
    // 500 addresses, one domain, one cache read
    assert.equal(validator.resolver.stats.cacheHits, 1);
    assert.equal(validator.resolver.stats.dnsQueries, 0);
  });

  it('never touches DNS for an address that failed syntax', async () => {
    const validator = new EmailValidator();
    const results = await validator.validateMany(['no-at-sign', 'a@b', '@nope.com']);
    assert.equal(validator.resolver.stats.dnsQueries, 0);
    assert.equal(results.every((r) => r.status === 'undeliverable'), true);
  });

  it('skipDns gives a syntax-only verdict that stays retryable', async () => {
    const validator = new EmailValidator({ skipDns: true });
    const result = await validator.validate('ahad@example.com');
    assert.equal(result.status, 'unknown');
    assert.equal(result.retryable, true);
    assert.equal(validator.resolver.stats.dnsQueries, 0);
  });
});

describe('Deduplicator', () => {
  it('treats gmail aliases as one mailbox', () => {
    const dedupe = new Deduplicator();
    assert.equal(dedupe.accept('johndoe@gmail.com'), true);
    assert.equal(dedupe.accept('johndoe@gmail.com'), false);
    assert.equal(dedupe.uniqueCount, 1);
    assert.equal(dedupe.duplicateCount, 1);
  });

  it('never merges rows it could not parse', () => {
    const dedupe = new Deduplicator();
    assert.equal(dedupe.accept(null), true);
    assert.equal(dedupe.accept(null), true);
    assert.equal(dedupe.duplicateCount, 0);
  });
});

describe('SummaryBuilder', () => {
  it('counts statuses, reasons and flags without holding the results', async () => {
    const validator = await seeded([
      info('gmail.com', { provider: 'google' }),
      info('mailinator.com'),
    ]);
    const results = await validator.validateMany([
      'ahad@gmail.com',
      'info@gmail.com',
      'broken',
      'someone@mailinator.com',
    ]);

    const builder = new SummaryBuilder();
    for (const result of results) builder.add(result);
    builder.addDuplicate();
    const summary = builder.build();

    assert.equal(summary.total, 4);
    assert.equal(summary.duplicates, 1);
    assert.equal(summary.byStatus.undeliverable, 1);
    assert.equal(summary.byStatus.risky, 2);
    assert.equal(summary.byStatus.unknown, 1);
    assert.equal(summary.byStatus.deliverable, 0);
    assert.equal(summary.byReason.role_account, 1);
    assert.equal(summary.byReason.disposable_domain, 1);
    assert.equal(summary.byProvider.google, 2);
    assert.equal(summary.coverage, 75);
  });

  it('reports zero coverage on an empty job instead of dividing by zero', () => {
    assert.equal(new SummaryBuilder().build().coverage, 0);
  });
});

describe('acceptsMail', () => {
  it('accepts a domain with MX, or with only an address record', () => {
    assert.equal(acceptsMail(info('a.com')), true);
    assert.equal(acceptsMail(info('a.com', { mx: [], hasAddressRecord: true })), true);
  });

  it('rejects a null-MX domain even though it resolves', () => {
    assert.equal(acceptsMail(info('a.com', { mx: [], nullMx: true, hasAddressRecord: true })), false);
  });
});

describe('MemoryDomainCache', () => {
  it('refuses to cache a DNS failure', async () => {
    const cache = new MemoryDomainCache();
    await cache.set(info('broken.com', { error: 'timeout' }));
    assert.equal(await cache.get('broken.com'), null);
  });

  it('expires entries past the TTL', async () => {
    const cache = new MemoryDomainCache({ ttlMs: 1000 });
    await cache.set(info('old.com', { checkedAt: Date.now() - 5000 }));
    assert.equal(await cache.get('old.com'), null);
  });

  it('evicts the least recently used entry at capacity', async () => {
    const cache = new MemoryDomainCache({ maxEntries: 2 });
    await cache.set(info('a.com'));
    await cache.set(info('b.com'));
    await cache.get('a.com'); // a.com is now the most recent
    await cache.set(info('c.com'));

    assert.equal(await cache.get('b.com'), null);
    assert.notEqual(await cache.get('a.com'), null);
    assert.notEqual(await cache.get('c.com'), null);
  });
});
