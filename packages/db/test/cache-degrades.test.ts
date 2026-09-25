import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import { PostgresDomainCache } from '../src/domain-cache.ts';
import type { Database } from '../src/client.ts';
import type { DomainInfo } from '@ev/core';

/**
 * The cache is an optimisation, and an optimisation must never be able to take
 * down the thing it was meant to speed up.
 *
 * This was a real failure: with Postgres unreachable, a single-address check
 * returned 500 instead of falling back to a plain DNS lookup — which is
 * exactly what a cache miss does anyway. These tests exist so it cannot come
 * back.
 */

/** A database that fails the way an unreachable Postgres does. */
function brokenDb(): Database {
  const boom = () => {
    throw new Error('ECONNREFUSED 127.0.0.1:5432');
  };
  return new Proxy({} as Database, { get: () => boom });
}

const info: DomainInfo = {
  domain: 'example.com',
  mx: ['mx.example.com'],
  nullMx: false,
  hasAddressRecord: false,
  nxdomain: false,
  error: null,
  provider: 'other',
  parked: null,
  checkedAt: Date.now(),
};

describe('PostgresDomainCache when the database is down', () => {
  it('reports a miss instead of throwing', async () => {
    const cache = new PostgresDomainCache({ db: brokenDb() });
    assert.equal(await cache.get('example.com'), null);
    assert.equal(cache.errors, 1);
  });

  it('returns an empty batch instead of throwing', async () => {
    const cache = new PostgresDomainCache({ db: brokenDb() });
    const found = await cache.getMany(['a.com', 'b.com']);
    assert.equal(found.size, 0);
  });

  it('swallows a failed write — the lookup can simply be repeated', async () => {
    const cache = new PostgresDomainCache({ db: brokenDb() });
    await cache.set(info);
    assert.equal(cache.errors, 1);
  });

  it('does not log once per row during a bulk job', async () => {
    const warn = mock.method(console, 'warn', () => {});
    try {
      const cache = new PostgresDomainCache({ db: brokenDb() });
      for (let i = 0; i < 500; i++) await cache.get(`domain${i}.com`);

      assert.equal(cache.errors, 500);
      // Throttled to roughly one a minute, so a ten-million-row job does not
      // bury every other log line.
      assert.equal(warn.mock.callCount(), 1);
    } finally {
      warn.mock.restore();
    }
  });

  it('still refuses to write a DNS failure, broken database or not', async () => {
    const cache = new PostgresDomainCache({ db: brokenDb() });
    await cache.set({ ...info, error: 'timeout' });
    // Rejected before the query, so nothing failed and nothing was counted.
    assert.equal(cache.errors, 0);
  });
});
