import { createWriteStream } from 'node:fs';
import { once } from 'node:events';
import type { Writable } from 'node:stream';
import type { EmailResult } from '@ev/core';

/**
 * Feature 17 — the result file, written as the job runs.
 *
 * The reason this class exists rather than a `rows.map(toCsv).join('\n')` is
 * back-pressure. `write()` returning false means the OS buffer is full; if we
 * ignore it and keep writing, Node queues the rest in memory and a job that
 * was carefully designed to stream ends up holding the whole output in RAM
 * anyway. So every write that comes back false is awaited on `drain`, which
 * pushes the pause all the way back up to the file reader.
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

export class ResultWriter {
  readonly #stream: Writable;
  #closed = false;
  #rows = 0;

  constructor(target: string | Writable) {
    this.#stream =
      typeof target === 'string'
        ? createWriteStream(target, { encoding: 'utf8', highWaterMark: 256 * 1024 })
        : target;
  }

  async writeHeader(): Promise<void> {
    await this.#write(`${RESULT_COLUMNS.join(',')}\n`);
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
    await this.#write(`${row.map(escapeCsv).join(',')}\n`);
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    await new Promise<void>((resolve, reject) => {
      this.#stream.end((error?: Error | null) => (error ? reject(error) : resolve()));
    });
  }

  get rowsWritten(): number {
    return this.#rows;
  }

  async #write(chunk: string): Promise<void> {
    if (!this.#stream.write(chunk)) await once(this.#stream, 'drain');
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
