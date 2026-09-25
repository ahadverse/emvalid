import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import type { EmailResult } from '@ev/core';
import { createResultWriter, resultFileExtension } from '../src/writer.ts';
import { readXlsxRows } from '../src/xlsx-reader.ts';

/**
 * Feature 32 — one contract, three formats. `processFile` only ever sees
 * `ResultWriter`; these tests go straight at each concrete writer so a bug in
 * one format's framing (JSON brackets, XLSX header row) cannot hide behind
 * `processFile`'s own CSV-shaped assertions.
 */

function sampleResult(overrides: Partial<EmailResult> = {}): EmailResult {
  return {
    input: 'Ahad@Example.com',
    normalized: 'ahad@example.com',
    canonical: 'ahad@example.com',
    localPart: 'ahad',
    domain: 'example.com',
    domainUnicode: null,
    status: 'unknown',
    advice: 'send',
    confidence: 50,
    reason: 'mailbox_unverified',
    detail: 'Domain accepts mail. This specific mailbox could not be confirmed.',
    retryable: false,
    suggestion: null,
    flags: {
      role: false,
      disposable: false,
      freeProvider: false,
      idn: false,
      alias: false,
      mxProvider: 'other',
    },
    ...overrides,
  };
}

let dir = '';

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ev-writer-'));
});

after(async () => {
  await rm(dir, { recursive: true, force: true });
});

function path(format: 'csv' | 'json' | 'xlsx'): string {
  return join(dir, `${Math.random().toString(36).slice(2)}${resultFileExtension(format)}`);
}

describe('resultFileExtension', () => {
  it('names the file after its format', () => {
    assert.equal(resultFileExtension('csv'), '.csv');
    assert.equal(resultFileExtension('json'), '.json');
    assert.equal(resultFileExtension('xlsx'), '.xlsx');
  });
});

describe('JsonResultWriter', () => {
  it('writes a parseable JSON array with one object per result', async () => {
    const file = path('json');
    const writer = createResultWriter('json', file);
    await writer.writeHeader();
    await writer.write(sampleResult({ input: 'a@example.com' }));
    await writer.write(sampleResult({ input: 'b@example.com', advice: 'do_not_send', reason: 'role_account' }));
    await writer.close();

    const rows = JSON.parse(await readFile(file, 'utf8')) as Array<Record<string, unknown>>;
    assert.equal(rows.length, 2);
    assert.equal(rows[0]?.input, 'a@example.com');
    assert.equal(rows[1]?.reason, 'role_account');
    // Booleans, not the CSV writer's 'yes'/'no' strings — JSON has its own type for this.
    assert.equal(rows[0]?.disposable, false);
    assert.equal(writer.rowsWritten, 2);
  });

  it('still writes a valid, parseable empty array when there are no rows', async () => {
    const file = path('json');
    const writer = createResultWriter('json', file);
    await writer.writeHeader();
    await writer.close();

    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), []);
  });

  it('carries a null suggestion through as JSON null, not the string "null"', async () => {
    const file = path('json');
    const writer = createResultWriter('json', file);
    await writer.writeHeader();
    await writer.write(sampleResult({ suggestion: null }));
    await writer.close();

    const [row] = JSON.parse(await readFile(file, 'utf8')) as Array<Record<string, unknown>>;
    assert.equal(row?.suggestion, null);
  });
});

describe('XlsxResultWriter', () => {
  it('writes a header row plus one row per result, readable back as XLSX', async () => {
    const file = path('xlsx');
    const writer = createResultWriter('xlsx', file);
    await writer.writeHeader();
    await writer.write(sampleResult({ input: 'a@example.com' }));
    await writer.write(sampleResult({ input: 'b@example.com', reason: 'disposable_domain' }));
    await writer.close();
    assert.equal(writer.rowsWritten, 2);

    const rows: string[][] = [];
    for await (const row of readXlsxRows(file)) rows.push(row);

    assert.equal(rows.length, 3); // header + 2
    assert.equal(rows[0]?.[0], 'input');
    assert.equal(rows[1]?.[0], 'a@example.com');
    assert.equal(rows[2]?.[5], 'disposable_domain'); // 'reason' column
  });
});
