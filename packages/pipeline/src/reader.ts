import { createReadStream } from 'node:fs';
import { open } from 'node:fs/promises';
import { extname } from 'node:path';
import { readCsvRows } from './csv-reader.ts';
import { readXlsxRows } from './xlsx-reader.ts';
import type { RowSource, SourceFormat } from './types.ts';

/**
 * Picks the reader. Extension first, then the file's own bytes.
 *
 * The bytes get the final say because users rename files. An xlsx saved as
 * `list.csv` parsed as text produces one enormous garbage row, and the job
 * would report a million invalid addresses instead of an error — a wrong
 * answer delivered confidently, which is the failure mode this project cares
 * most about avoiding.
 */

/** `PK\x03\x04` — every xlsx is a zip archive. */
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

export async function detectFormat(path: string): Promise<SourceFormat> {
  const handle = await open(path, 'r');
  try {
    const header = Buffer.alloc(4);
    const { bytesRead } = await handle.read(header, 0, 4, 0);
    if (bytesRead === 4 && header.equals(ZIP_MAGIC)) return 'xlsx';
  } finally {
    await handle.close();
  }

  // Old .xls (BIFF, not a zip) is not supported. It reaches here and will be
  // read as text, which fails loudly on the column detector rather than
  // quietly producing nonsense.
  return extname(path).toLowerCase() === '.xlsx' ? 'xlsx' : 'csv';
}

export async function openRows(path: string): Promise<{ rows: RowSource; format: SourceFormat }> {
  const format = await detectFormat(path);

  if (format === 'xlsx') return { rows: readXlsxRows(path), format };

  return {
    rows: readCsvRows(createReadStream(path, { highWaterMark: 256 * 1024 })),
    format,
  };
}
