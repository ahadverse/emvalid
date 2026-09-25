import { createWriteStream } from 'node:fs';
import { once } from 'node:events';
import type { Writable } from 'node:stream';
import type { EmailResult } from '@ev/core';

/**
 * Feature 17 — the result file, written as the job runs.
 *
 * The reason `CsvResultWriter` exists rather than a `rows.map(toCsv).join('\n')`
 * is back-pressure. `write()` returning false means the OS buffer is full; if we
 * ignore it and keep writing, Node queues the rest in memory and a job that
 * was carefully designed to stream ends up holding the whole output in RAM
 * anyway. So every write that comes back false is awaited on `drain`, which
 * pushes the pause all the way back up to the file reader. `JsonResultWriter`
 * follows the same discipline; `XlsxResultWriter` gets it for free from
 * exceljs's own streaming workbook writer.
 *
 * Feature 32 — three formats, one contract. Nothing upstream of `write()`
 * needs to know which one is active.
 */

export const RESULT_COLUMNS = [
  'input',
  'normalized',
  // First of the verdict columns, because it is the one a user sorts and
  // filters on. `status` sits behind it for anyone who wants the precise
  // finding rather than the recommendation.
  'advice',
  'status',
  'confidence',
  'reason',
  'detail',
  'suggestion',
  'role',
  'disposable',
  'free_provider',
  'mx_provider',
] as const;

export type ResultFormat = 'csv' | 'json' | 'xlsx';

export function resultFileExtension(format: ResultFormat): string {
  return `.${format}`;
}

export interface ResultWriter {
  writeHeader(): Promise<void>;
  write(result: EmailResult): Promise<void>;
  close(): Promise<void>;
  readonly rowsWritten: number;
}

export function createResultWriter(format: ResultFormat, target: string | Writable): ResultWriter {
  switch (format) {
    case 'csv':
      return new CsvResultWriter(target);
    case 'json':
      return new JsonResultWriter(target);
    case 'xlsx':
      return new XlsxResultWriter(target);
  }
}

/**
 * One row, typed and in `RESULT_COLUMNS` order. `CsvResultWriter` keeps its
 * own hand-built row array — changing its 12 hand-written cells to route
 * through here risks the one format with the longest history of passing
 * tests — but JSON and XLSX both build their row from this, so the three
 * formats cannot silently drift apart on which fields they carry.
 */
function resultRow(result: EmailResult): Record<(typeof RESULT_COLUMNS)[number], unknown> {
  const flags = result.flags;
  return {
    input: result.input,
    normalized: result.normalized,
    advice: result.advice,
    status: result.status,
    confidence: result.confidence,
    reason: result.reason,
    detail: result.detail,
    suggestion: result.suggestion,
    role: flags.role,
    disposable: flags.disposable,
    free_provider: flags.freeProvider,
    mx_provider: flags.mxProvider,
  };
}

function openStream(target: string | Writable): Writable {
  return typeof target === 'string'
    ? createWriteStream(target, { encoding: 'utf8', highWaterMark: 256 * 1024 })
    : target;
}

async function writeChunk(stream: Writable, chunk: string): Promise<void> {
  if (!stream.write(chunk)) await once(stream, 'drain');
}

function endStream(stream: Writable): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    stream.end((error?: Error | null) => (error ? reject(error) : resolve()));
  });
}

export class CsvResultWriter implements ResultWriter {
  readonly #stream: Writable;
  #closed = false;
  #rows = 0;

  constructor(target: string | Writable) {
    this.#stream = openStream(target);
  }

  async writeHeader(): Promise<void> {
    await writeChunk(this.#stream, `${RESULT_COLUMNS.join(',')}\n`);
  }

  async write(result: EmailResult): Promise<void> {
    const flags = result.flags;
    const row = [
      result.input,
      result.normalized ?? '',
      result.advice,
      result.status,
      String(result.confidence),
      result.reason,
      result.detail,
      result.suggestion ?? '',
      flags.role ? 'yes' : 'no',
      flags.disposable ? 'yes' : 'no',
      flags.freeProvider ? 'yes' : 'no',
      flags.mxProvider ?? '',
    ];

    this.#rows++;
    await writeChunk(this.#stream, `${row.map(escapeCsv).join(',')}\n`);
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    await endStream(this.#stream);
  }

  get rowsWritten(): number {
    return this.#rows;
  }
}

/**
 * Quote only when the value would otherwise break the file. A leading `=`,
 * `+`, `-` or `@` is prefixed with a quote as well: Excel treats those as the
 * start of a formula, and an address column is exactly where a hostile value
 * would be planted.
 */
export function escapeCsv(value: string): string {
  const needsFormulaGuard = /^[=+\-@\t\r]/.test(value);
  const body = needsFormulaGuard ? `'${value}` : value;

  if (!/[",\n\r]/.test(body) && !needsFormulaGuard) return body;
  return `"${body.replaceAll('"', '""')}"`;
}

/**
 * A JSON array, streamed one object at a time. `writeHeader` opens the `[`
 * and `close` writes the matching `]` — there is no header row in the CSV
 * sense, but the interface still needs the call before any `write`.
 */
export class JsonResultWriter implements ResultWriter {
  readonly #stream: Writable;
  #closed = false;
  #rows = 0;
  #first = true;

  constructor(target: string | Writable) {
    this.#stream = openStream(target);
  }

  async writeHeader(): Promise<void> {
    await writeChunk(this.#stream, '[\n');
  }

  async write(result: EmailResult): Promise<void> {
    const prefix = this.#first ? '' : ',\n';
    this.#first = false;
    this.#rows++;
    await writeChunk(this.#stream, `${prefix}${JSON.stringify(resultRow(result))}`);
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    await writeChunk(this.#stream, this.#rows === 0 ? ']\n' : '\n]\n');
    await endStream(this.#stream);
  }

  get rowsWritten(): number {
    return this.#rows;
  }
}

/**
 * exceljs is imported dynamically, same reasoning as `xlsx-reader.ts`: it is
 * a heavy dependency and the overwhelming majority of jobs are not XLSX
 * output, so paying its parse/load cost is opt-in.
 */
export class XlsxResultWriter implements ResultWriter {
  readonly #target: string | Writable;
  // exceljs ships no types worth importing just for this internal field.
  #workbook: { addWorksheet: (name: string) => ExcelWorksheet; commit: () => Promise<void> } | null = null;
  #sheet: ExcelWorksheet | null = null;
  #closed = false;
  #rows = 0;

  constructor(target: string | Writable) {
    this.#target = target;
  }

  async writeHeader(): Promise<void> {
    // See the comment in xlsx-reader.ts: exceljs is CommonJS, and under this
    // project's module resolution the real module lands on `.default`.
    const { default: ExcelJS } = await import('exceljs');
    const options =
      typeof this.#target === 'string'
        ? { filename: this.#target, useStyles: false, useSharedStrings: false }
        : { stream: this.#target, useStyles: false, useSharedStrings: false };

    this.#workbook = new ExcelJS.stream.xlsx.WorkbookWriter(
      options as ConstructorParameters<typeof ExcelJS.stream.xlsx.WorkbookWriter>[0],
    ) as unknown as { addWorksheet: (name: string) => ExcelWorksheet; commit: () => Promise<void> };
    this.#sheet = this.#workbook.addWorksheet('Results');
    this.#sheet.addRow([...RESULT_COLUMNS]).commit();
  }

  async write(result: EmailResult): Promise<void> {
    if (this.#sheet === null) throw new Error('writeHeader() must run before write()');
    this.#sheet.addRow(Object.values(resultRow(result))).commit();
    this.#rows++;
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    this.#sheet?.commit();
    await this.#workbook?.commit();
  }

  get rowsWritten(): number {
    return this.#rows;
  }
}

interface ExcelRow {
  commit(): void;
}
interface ExcelWorksheet {
  addRow(values: unknown[]): ExcelRow;
  commit(): void;
}
