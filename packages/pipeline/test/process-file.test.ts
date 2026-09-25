import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { EmailValidator } from '@ev/core';
import { detectEmailColumn } from '../src/column-detect.ts';
import { escapeCsv } from '../src/writer.ts';
import { processFile } from '../src/process-file.ts';

/**
 * Every run uses `skipDns: true`. The pipeline's job is rows in and rows out;
 * whether a domain resolves is core's business and is tested there. Keeping
 * DNS out also means this suite passes offline.
 */
const validator = () => new EmailValidator({ skipDns: true });

let dir = '';

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ev-pipeline-'));
});

after(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function run(csv: string, options: { dedupe?: boolean } = {}) {
  const id = Math.random().toString(36).slice(2);
  const inputPath = join(dir, `${id}.csv`);
  const outputPath = join(dir, `${id}.out.csv`);
  await writeFile(inputPath, csv, 'utf8');

  const outcome = await processFile({
    inputPath,
    outputPath,
    validator: validator(),
    batchSize: 3,
    ...options,
  });

  const output = await readFile(outputPath, 'utf8');
  return { ...outcome, output, lines: output.trimEnd().split('\n') };
}

describe('processFile', () => {
  it('validates the email column and writes one row per address', async () => {
    const { summary, lines } = await run(
      'name,email\nAhad,ahad@example.com\nRahim,rahim@example.com\n',
    );

    assert.equal(summary.total, 2);
    assert.equal(lines.length, 3); // header + 2
    // `advice` sits ahead of `status`: it is the column a user filters on.
    assert.match(lines[0]!, /^input,normalized,advice,status,confidence,reason/);
    assert.match(lines[1]!, /ahad@example\.com/);
  });

  it('skips the header row rather than validating it', async () => {
    const { summary, output } = await run('email\na@example.com\n');
    assert.equal(summary.total, 1);
    assert.equal(output.includes('\nemail,'), false);
  });

  it('reads a headerless file', async () => {
    const { summary, column } = await run('a@example.com\nb@example.com\n');
    assert.equal(column.hasHeader, false);
    assert.equal(summary.total, 2);
  });

  it('picks the column that holds addresses when the header lies', async () => {
    const { column } = await run(
      'email,contact\n,ahad@x.com\n,rahim@x.com\n,karim@x.com\n,jamal@x.com\n',
    );
    assert.equal(column.index, 1);
    assert.match(column.reason, /holds no addresses/);
  });

  it('ignores blank cells instead of counting them as invalid', async () => {
    const { summary } = await run('email\na@example.com\n\nb@example.com\n');
    assert.equal(summary.total, 2);
    assert.equal(summary.byStatus.undeliverable, 0);
  });

  it('collapses gmail aliases and leaves duplicates out of the output', async () => {
    const { summary, lines } = await run(
      'email\nJohn.Doe@gmail.com\njohndoe+promo@googlemail.com\nother@example.com\n',
    );

    assert.equal(summary.duplicates, 1);
    assert.equal(summary.total, 2);
    assert.equal(lines.length, 3); // header + 2 unique
  });

  it('keeps every row when dedupe is off', async () => {
    const { summary, lines } = await run(
      'email\nsame@gmail.com\nsame@gmail.com\n',
      { dedupe: false },
    );

    assert.equal(summary.duplicates, 0);
    assert.equal(summary.total, 2);
    assert.equal(lines.length, 3);
  });

  it('crosses batch boundaries without losing or repeating a row', async () => {
    const rows = Array.from({ length: 25 }, (_, i) => `user${i}@example.com`);
    const { summary, lines } = await run(`email\n${rows.join('\n')}\n`);

    assert.equal(summary.total, 25);
    assert.equal(lines.length, 26);
  });

  it('handles a file shorter than the sniff window', async () => {
    const { summary } = await run('email\nonly@example.com\n');
    assert.equal(summary.total, 1);
  });

  it('reports an empty file without crashing', async () => {
    const { summary } = await run('');
    assert.equal(summary.total, 0);
    assert.equal(summary.coverage, 0);
  });

  it('stops when the signal aborts', async () => {
    const rows = Array.from({ length: 500 }, (_, i) => `user${i}@example.com`);
    const inputPath = join(dir, 'abort.csv');
    const outputPath = join(dir, 'abort.out.csv');
    await writeFile(inputPath, `email\n${rows.join('\n')}\n`, 'utf8');

    const controller = new AbortController();
    controller.abort();

    await assert.rejects(
      processFile({ inputPath, outputPath, validator: validator(), signal: controller.signal }),
      (error: Error) => error.name === 'AbortError',
    );
  });

  it('carries advice, status, reason and detail into the output columns', async () => {
    const { output, summary } = await run('email\ninfo@example.com\nbroken-address\n');
    assert.match(output, /risky/);
    assert.match(output, /role_account/);
    assert.match(output, /undeliverable/);
    assert.match(output, /syntax_invalid/);
    assert.match(output, /do_not_send/);
    assert.match(output, /review/);
    assert.equal(summary.byAdvice.do_not_send, 1);
    assert.equal(summary.byAdvice.review, 1);
  });

  it('writes JSON instead of CSV when a format is given', async () => {
    const inputPath = join(dir, 'format.csv');
    const outputPath = join(dir, 'format.out.json');
    await writeFile(inputPath, 'email\na@example.com\n', 'utf8');

    await processFile({ inputPath, outputPath, validator: validator(), format: 'json' });

    const rows = JSON.parse(await readFile(outputPath, 'utf8')) as Array<{ input: string }>;
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.input, 'a@example.com');
  });

  it('applies transform to every result before it is counted or written', async () => {
    const inputPath = join(dir, 'transform.csv');
    const outputPath = join(dir, 'transform.out.csv');
    await writeFile(inputPath, 'email\ninfo@example.com\n', 'utf8');

    const { summary } = await processFile({
      inputPath,
      outputPath,
      validator: validator(),
      // A stand-in for features 30/31's override step: force everything to 'send'.
      transform: (result) => ({ ...result, advice: 'send' }),
    });

    const output = await readFile(outputPath, 'utf8');
    assert.equal(summary.byAdvice.send, 1);
    assert.equal(summary.byAdvice.review, 0);
    assert.match(output.split('\n')[1] ?? '', /,send,/);
  });
});

describe('escapeCsv', () => {
  it('leaves ordinary values alone', () => {
    assert.equal(escapeCsv('ahad@example.com'), 'ahad@example.com');
  });

  it('quotes values containing a comma, quote or newline', () => {
    assert.equal(escapeCsv('Doe, John'), '"Doe, John"');
    assert.equal(escapeCsv('say "hi"'), '"say ""hi"""');
    assert.equal(escapeCsv('two\nlines'), '"two\nlines"');
  });

  it('neutralises a value Excel would read as a formula', () => {
    // =HYPERLINK(...) in a result file is a real attack, not a curiosity
    assert.equal(escapeCsv('=1+1'), `"'=1+1"`);
    assert.equal(escapeCsv('+cmd'), `"'+cmd"`);
  });
});

describe('detectEmailColumn', () => {
  it('names the column from an obvious header', () => {
    const detection = detectEmailColumn([
      ['name', 'email'],
      ['Ahad', 'a@b.com'],
    ]);
    assert.equal(detection.index, 1);
    assert.equal(detection.hasHeader, true);
    assert.ok(detection.confidence >= 95);
  });

  it('recognises a non-English header', () => {
    const detection = detectEmailColumn([
      ['nombre', 'correo'],
      ['Ana', 'a@b.com'],
    ]);
    assert.equal(detection.index, 1);
  });

  it('reports zero confidence when no column holds an address', () => {
    const detection = detectEmailColumn([
      ['a', 'b'],
      ['1', '2'],
    ]);
    assert.equal(detection.confidence, 0);
  });

  it('does not mistake a postal address column for email', () => {
    const detection = detectEmailColumn([
      ['address', 'contact'],
      ['12 Road, Dhaka', 'ahad@x.com'],
      ['5 Lane, Khulna', 'rahim@x.com'],
      ['9 Ave, Sylhet', 'karim@x.com'],
    ]);
    assert.equal(detection.index, 1);
  });
});
