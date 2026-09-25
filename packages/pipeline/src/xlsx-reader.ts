import type { RowSource } from './types.ts';

/**
 * Feature 14 — XLSX input, same one-row-at-a-time contract as the CSV reader.
 *
 * exceljs is imported dynamically on purpose. It is a heavy dependency and the
 * overwhelming majority of jobs are CSV; loading it at module scope would cost
 * every worker process the parse time and memory for a code path most of them
 * never take. It also keeps the CSV tests free of it entirely.
 */

/** Cell values arrive typed; the pipeline only ever wants the text. */
function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Date) return value.toISOString();

  // Hyperlink and rich-text cells are objects. An address pasted into Excel
  // usually becomes a mailto: hyperlink, so this branch is the common case for
  // exactly the column we care about, not an edge case.
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (typeof record.text === 'string') return record.text;
    if (typeof record.hyperlink === 'string') return record.hyperlink.replace(/^mailto:/i, '');
    if (typeof record.result === 'string' || typeof record.result === 'number') {
      return String(record.result); // formula cell — take the computed value
    }
    if (Array.isArray(record.richText)) {
      return record.richText.map((part) => cellText((part as { text?: unknown }).text)).join('');
    }
  }

  return String(value);
}

export async function* readXlsxRows(path: string): RowSource {
  // exceljs is CommonJS; under this project's module resolution the dynamic
  // import lands the real module on `.default`, not on the namespace object
  // itself — `(await import('exceljs')).stream` is `undefined`.
  const { default: ExcelJS } = await import('exceljs');

  // Streaming reader: rows are emitted as the file is parsed rather than the
  // workbook being materialised. A 600 MB xlsx read the ordinary way is a
  // multi-gigabyte object graph.
  const workbook = new ExcelJS.stream.xlsx.WorkbookReader(path, {
    entries: 'emit',
    sharedStrings: 'cache',
    worksheets: 'emit',
    styles: 'ignore',
  });

  for await (const worksheet of workbook) {
    for await (const row of worksheet) {
      const cells: string[] = [];

      // `values` is 1-based with a hole at index 0 — an exceljs quirk that
      // silently shifts every column by one if you forget it.
      const values = row.values as unknown[];
      for (let i = 1; i < values.length; i++) cells.push(cellText(values[i]));

      yield cells;
    }

    // Only the first sheet. A workbook with the list split across tabs is
    // rare, and silently concatenating sheets with different columns would be
    // worse than ignoring them.
    break;
  }
}
