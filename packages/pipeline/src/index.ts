/**
 * @ev/pipeline — file in, result file out, in constant memory.
 *
 * Everything here streams. The package holds no opinion about validation
 * (that is `@ev/core`) or about jobs and storage (that is `@ev/db`); it turns
 * a spreadsheet into a sequence of addresses and a sequence of results back
 * into a spreadsheet.
 */

export { readCsvRows, type CsvReaderOptions } from './csv-reader.ts';
export { readXlsxRows } from './xlsx-reader.ts';
export { detectFormat, openRows } from './reader.ts';
export { SNIFF_ROWS, detectEmailColumn, type ColumnDetection } from './column-detect.ts';
export { RESULT_COLUMNS, ResultWriter, escapeCsv } from './writer.ts';
export {
  processFile,
  type ProcessFileOptions,
  type ProcessFileOutcome,
  type ProcessProgress,
} from './process-file.ts';
export type { RowSource, SourceFormat } from './types.ts';
