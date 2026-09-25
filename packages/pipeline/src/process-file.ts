import {
  Deduplicator,
  SummaryBuilder,
  parseEmail,
  type EmailResult,
  type EmailValidator,
  type JobSummary,
  type ParsedEmail,
} from '@ev/core';
import { SNIFF_ROWS, detectEmailColumn, type ColumnDetection } from './column-detect.ts';
import { openRows } from './reader.ts';
import { createResultWriter, type ResultFormat } from './writer.ts';
import type { SourceFormat } from './types.ts';

/**
 * Features 15, 17 and 18 — the whole job, start to finish, in constant memory.
 *
 * The shape of the loop is the design:
 *
 *   read one row  →  parse  →  dedupe  →  batch  →  resolve domains  →
 *   classify  →  write  →  count  →  forget
 *
 * Nothing accumulates except the dedupe key set and the summary counters. Ten
 * million rows and ten thousand rows use the same amount of memory, and if a
 * change to this file ever breaks that, the job will not fail — it will
 * succeed slowly and then die on somebody's real file. Which is why the
 * comments here are about memory and not about CSV.
 */

export interface ProcessFileOptions {
  inputPath: string;
  outputPath: string;
  /** Constructed by the caller so cache and DNS settings live in one place. */
  validator: EmailValidator;
  /** Feature 32. Defaults to 'csv' — the format the caller chose `outputPath`'s extension for. */
  format?: ResultFormat;
  /**
   * Features 30/31 — a user's own address-level and reason-level overrides,
   * applied to every result right after the engine classifies it and before
   * it is counted or written. Pure and synchronous on purpose: the caller
   * loads whatever rules it needs once, up front, and closes over them here
   * rather than this file knowing anything about accounts or a database.
   */
  transform?: (result: EmailResult) => EmailResult;
  /** Rows per DNS/classify batch. Bigger batches group domains better. */
  batchSize?: number;
  /**
   * Alias-aware duplicate removal (feature 4). When on, a repeated mailbox is
   * counted in the summary and **left out of the output file** — it is the
   * same mailbox, so a second row would carry an identical verdict and only
   * make the file bigger. Turn it off to get one output row per input row.
   */
  dedupe?: boolean;
  onProgress?: (progress: ProcessProgress) => void;
  /** Fires roughly this often, never per row. */
  progressIntervalMs?: number;
  signal?: AbortSignal;
}

export interface ProcessProgress {
  /** Data rows read so far, duplicates included. */
  processed: number;
  /** Rows written to the result file. */
  written: number;
}

export interface ProcessFileOutcome {
  summary: JobSummary;
  /** Which column was validated and why — surface this in the UI. */
  column: ColumnDetection;
  format: SourceFormat;
}

export async function processFile(options: ProcessFileOptions): Promise<ProcessFileOutcome> {
  const {
    inputPath,
    outputPath,
    validator,
    format: resultFormat = 'csv',
    transform,
    batchSize = 1000,
    dedupe = true,
    onProgress,
    progressIntervalMs = 500,
    signal,
  } = options;

  const { rows, format } = await openRows(inputPath);
  const writer = createResultWriter(resultFormat, outputPath);
  const summary = new SummaryBuilder();
  const deduper = new Deduplicator();

  let column: ColumnDetection | null = null;
  let processed = 0;
  let lastProgress = 0;

  const report = (force = false): void => {
    if (onProgress === undefined) return;
    const now = Date.now();
    if (!force && now - lastProgress < progressIntervalMs) return;
    lastProgress = now;
    onProgress({ processed, written: writer.rowsWritten });
  };

  const batch: ParsedEmail[] = [];

  const flush = async (): Promise<void> => {
    if (batch.length === 0) return;

    // Domain grouping happens inside the validator: one DNS lookup per
    // distinct domain in the batch, not one per address.
    const results = await validator.classifyParsed(batch);
    for (const raw of results) {
      const result = transform ? transform(raw) : raw;
      summary.add(result);
      await writer.write(result);
    }

    batch.length = 0;
    report();
  };

  try {
    await writer.writeHeader();

    // The column cannot be chosen until we have seen some data, so the first
    // rows are held back — bounded by SNIFF_ROWS, the one place in this file
    // where rows are buffered at all.
    const sniff: string[][] = [];

    for await (const row of rows) {
      throwIfAborted(signal);

      if (column === null) {
        sniff.push(row);
        if (sniff.length <= SNIFF_ROWS) continue;

        column = detectEmailColumn(sniff);
        for (const held of sniff.slice(column.hasHeader ? 1 : 0)) {
          processed++;
          take(held);
          if (batch.length >= batchSize) await flush();
        }
        sniff.length = 0;
        continue;
      }

      processed++;
      take(row);
      if (batch.length >= batchSize) await flush();
      report();
    }

    // A file shorter than the sniff window never reached the branch above.
    if (column === null) {
      column = detectEmailColumn(sniff);
      for (const held of sniff.slice(column.hasHeader ? 1 : 0)) {
        processed++;
        take(held);
        if (batch.length >= batchSize) await flush();
      }
    }

    await flush();
    report(true);
  } finally {
    // Always close: an aborted or failed job must not leave a half-written
    // file with an open descriptor behind it.
    await writer.close();
  }

  return { summary: summary.build(), column, format };

  function take(row: string[]): void {
    const raw = (row[column!.index] ?? '').trim();

    // A blank cell is a blank row, not an invalid address. Counting it as
    // undeliverable would inflate the one number users judge us by.
    if (raw.length === 0) return;

    const parsed = parseEmail(raw);

    if (dedupe && !deduper.accept(parsed.canonical)) {
      summary.addDuplicate();
      return;
    }

    batch.push(parsed);
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    throw new DOMException('Job cancelled', 'AbortError');
  }
}
