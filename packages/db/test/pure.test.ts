import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import type { DomainInfo } from '@ev/core';
import { API_KEY_PREFIX_LENGTH, apiKeyPrefix, generateApiKey, hashApiKey } from '../src/api-keys.ts';
import { DEFAULT_TTL_MS, domainInfoToRow, isFresh, rowToDomainInfo } from '../src/domain-cache.ts';
import { DEFAULT_RETENTION_DAYS, intervalLiteral, retentionExpiry } from '../src/queue.ts';
import { daysAgo, removeFiles } from '../src/retention.ts';

/**
 * Everything here is pure or touches only the filesystem. The queries
 * themselves are exercised by `integration.test.ts`, which needs a real
 * Postgres and skips itself without one.
 */

describe('api keys', () => {
  it('generates a namespaced, unguessable key', () => {
    const key = generateApiKey();
    assert.match(key, /^ev_live_[A-Za-z0-9_-]{40,}$/);
    assert.notEqual(key, generateApiKey());
  });

  it('hashes deterministically, and differently for different keys', () => {
    const key = generateApiKey();
    assert.equal(hashApiKey(key), hashApiKey(key));
    assert.notEqual(hashApiKey(key), hashApiKey(generateApiKey()));
    assert.match(hashApiKey(key), /^[0-9a-f]{64}$/);
  });

  it('never lets the hash reveal the key', () => {
    const key = generateApiKey();
    assert.equal(hashApiKey(key).includes(key.slice(8)), false);
  });

  it('takes a prefix short enough to be useless on its own', () => {
    const key = generateApiKey();
    const prefix = apiKeyPrefix(key);
    assert.equal(prefix, key.slice(0, 'ev_live_'.length + API_KEY_PREFIX_LENGTH));
    assert.ok(prefix.length < key.length / 2);
  });
});

describe('queue helpers', () => {
  it('sets expiry the configured number of days out', () => {
    const from = new Date('2026-01-01T00:00:00Z');
    assert.equal(retentionExpiry(from, 7).toISOString(), '2026-01-08T00:00:00.000Z');
    assert.equal(
      retentionExpiry(from).getTime(),
      from.getTime() + DEFAULT_RETENTION_DAYS * 86_400_000,
    );
  });

  it('renders an interval Postgres will accept', () => {
    assert.match(intervalLiteral(5000), /5000|5\s*second/i);
  });

  it('never renders a negative interval', () => {
    assert.doesNotMatch(intervalLiteral(-1), /-/);
  });
});

describe('domain cache mapping', () => {
  const info: DomainInfo = {
    domain: 'example.com',
    mx: ['mx1.example.com', 'mx2.example.com'],
    nullMx: false,
    hasAddressRecord: true,
    nxdomain: false,
    error: null,
    provider: 'google',
    checkedAt: Date.parse('2026-02-03T10:00:00Z'),
  };

  it('round-trips without losing a field', () => {
    assert.deepEqual(rowToDomainInfo(domainInfoToRow(info)), info);
  });

  it('always reads back with error null — a failure is never a cached row', () => {
    const row = domainInfoToRow({ ...info, error: 'timeout' });
    assert.equal(rowToDomainInfo(row).error, null);
  });

  it('treats a row inside the TTL as fresh and one outside as stale', () => {
    const now = Date.now();
    assert.equal(isFresh(new Date(now - 1000), DEFAULT_TTL_MS, now), true);
    assert.equal(isFresh(new Date(now - DEFAULT_TTL_MS - 1), DEFAULT_TTL_MS, now), false);
  });

  it('treats the TTL boundary itself as fresh', () => {
    const now = Date.now();
    assert.equal(isFresh(new Date(now - DEFAULT_TTL_MS), DEFAULT_TTL_MS, now), true);
  });
});

describe('retention', () => {
  let dir = '';

  before(async () => {
    dir = await mkdtemp(join(tmpdir(), 'ev-db-'));
  });

  after(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('computes an instant N days back', () => {
    const now = new Date('2026-03-10T00:00:00Z');
    assert.equal(daysAgo(3, now).toISOString(), '2026-03-07T00:00:00.000Z');
  });

  it('deletes the files it is given', async () => {
    const path = join(dir, 'result.csv');
    await writeFile(path, 'x', 'utf8');

    const result = await removeFiles([path]);
    assert.equal(result.deleted, 1);
    assert.equal(result.failed.length, 0);
    await assert.rejects(readFile(path));
  });

  it('treats an already-missing file as success', async () => {
    // An interrupted earlier sweep is the likeliest reason for this, and the
    // desired end state is the same either way.
    const result = await removeFiles([join(dir, 'never-existed.csv')]);
    assert.equal(result.deleted, 1);
    assert.equal(result.failed.length, 0);
  });

  it('ignores null and empty paths — a failed job has no output file', async () => {
    const result = await removeFiles([null, '']);
    assert.equal(result.deleted, 0);
    assert.equal(result.failed.length, 0);
  });
});
