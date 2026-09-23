import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { describe, it } from 'node:test';
import { readCsvRows } from '../src/csv-reader.ts';

async function parse(text: string, chunkSize = text.length): Promise<string[][]> {
  // Feeding the parser in slices proves it survives a chunk boundary landing
  // anywhere — mid-field, mid-quote, or between the CR and the LF.
  const chunks: Buffer[] = [];
  for (let i = 0; i < text.length; i += chunkSize) {
    chunks.push(Buffer.from(text.slice(i, i + chunkSize), 'utf8'));
  }

  const rows: string[][] = [];
  for await (const row of readCsvRows(Readable.from(chunks))) rows.push(row);
  return rows;
}

describe('readCsvRows', () => {
  it('reads a plain file', async () => {
    assert.deepEqual(await parse('a,b\n1,2\n'), [['a', 'b'], ['1', '2']]);
  });

  it('handles a quoted field containing the delimiter', async () => {
    assert.deepEqual(await parse('name,email\n"Doe, John",j@x.com\n'), [
      ['name', 'email'],
      ['Doe, John', 'j@x.com'],
    ]);
  });

  it('handles a quoted field containing a line break', async () => {
    assert.deepEqual(await parse('note,email\n"line one\nline two",j@x.com\n'), [
      ['note', 'email'],
      ['line one\nline two', 'j@x.com'],
    ]);
  });

  it('unescapes doubled quotes', async () => {
    assert.deepEqual(await parse('a\n"say ""hi"""\n'), [['a'], ['say "hi"']]);
  });

  it('strips a UTF-8 BOM from the first header cell', async () => {
    const rows = await parse('﻿email,name\na@b.com,x\n');
    assert.equal(rows[0]?.[0], 'email');
  });

  it('treats CRLF as one row terminator', async () => {
    assert.deepEqual(await parse('a,b\r\n1,2\r\n'), [['a', 'b'], ['1', '2']]);
  });

  it('sniffs a semicolon-delimited file', async () => {
    assert.deepEqual(await parse('name;email\nAhad;a@b.com\n'), [
      ['name', 'email'],
      ['Ahad', 'a@b.com'],
    ]);
  });

  it('sniffs a tab-delimited file', async () => {
    assert.deepEqual(await parse('name\temail\nAhad\ta@b.com\n'), [
      ['name', 'email'],
      ['Ahad', 'a@b.com'],
    ]);
  });

  it('keeps commas inside a semicolon file as text', async () => {
    const rows = await parse('name;email\nDoe, John;j@x.com\n');
    assert.deepEqual(rows[1], ['Doe, John', 'j@x.com']);
  });

  it('reads a final row with no trailing newline', async () => {
    assert.deepEqual(await parse('a,b\n1,2'), [['a', 'b'], ['1', '2']]);
  });

  it('drops blank lines instead of reporting phantom rows', async () => {
    assert.deepEqual(await parse('a\n\n1\n\n'), [['a'], ['1']]);
  });

  it('produces identical rows however the stream is chunked', async () => {
    const text = 'name,email\n"Doe, John","j@x.com"\r\n"multi\nline",b@c.com\n';
    const whole = await parse(text);
    for (const size of [1, 2, 3, 7, 13]) {
      assert.deepEqual(await parse(text, size), whole, `chunk size ${size}`);
    }
  });

  it('decodes a multi-byte character split across chunks', async () => {
    const text = 'নাম,email\nআহাদ,a@b.com\n';
    assert.deepEqual(await parse(text, 3), [
      ['নাম', 'email'],
      ['আহাদ', 'a@b.com'],
    ]);
  });
});
