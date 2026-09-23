import type { Readable } from 'node:stream';

/**
 * Feature 14/15 — a CSV reader that never holds more than one row.
 *
 * Written by hand rather than pulled from npm because the whole job is a
 * character state machine plus a delimiter sniff, and every off-the-shelf
 * parser we looked at either buffers the file or hands back objects keyed by
 * header — both of which put memory in proportion to the input, which is the
 * one thing a ten-million-row job cannot afford.
 *
 * What real exports throw at us, and is handled here: RFC 4180 quoting with
 * `""` escapes, quoted fields containing the delimiter or a line break, CRLF
 * and LF endings mixed in one file, a UTF-8 BOM from Excel, and `;` or tab
 * delimiters from a European locale.
 */

export interface CsvReaderOptions {
  /** Skip sniffing when the caller already knows what it has. */
  delimiter?: string;
}

/** Sniffed in this order, so a tie keeps the comma. */
const DELIMITERS = [',', ';', '\t'];

const BOM = '\uFEFF';

/**
 * How much text we will hold waiting for the first line terminator before
 * giving up and sniffing on what we have. A header line longer than this means
 * the file is not what the user thinks it is.
 */
const MAX_SNIFF_BYTES = 64 * 1024;

/**
 * Rows come out as raw cell strings, in file order, one at a time.
 *
 * The stream is consumed with `for await`, which pauses it whenever the
 * consumer is slow — that back-pressure is what keeps the read side flat while
 * DNS is the bottleneck.
 */
export async function* readCsvRows(
  input: Readable,
  options: CsvReaderOptions = {},
): AsyncGenerator<string[]> {
  const parser = new CsvParser(options.delimiter ?? null);
  // Decodes across chunk boundaries, so a multi-byte character split down the
  // middle by the 64 KB read size does not turn into two replacement chars.
  const decoder = new TextDecoder('utf-8');

  for await (const chunk of input as AsyncIterable<Buffer | string>) {
    const text = typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true });
    if (text.length > 0) yield* parser.push(text);
  }

  const tail = decoder.decode();
  if (tail.length > 0) yield* parser.push(tail);
  yield* parser.end();
}

type ParserState =
  /** Between fields: a `"` here opens a quoted field. */
  | 'start'
  /** Inside an unquoted field. */
  | 'plain'
  /** Inside a quoted field; delimiters and line breaks are just text. */
  | 'quoted'
  /** Saw a `"` inside a quoted field — a second one is an escaped quote. */
  | 'quote';

class CsvParser {
  #delimiter: string | null;
  /** Held only until the delimiter is sniffed, i.e. the first line. */
  #buffered = '';
  #atStart = true;

  #state: ParserState = 'start';
  #field = '';
  #row: string[] = [];
  /** Distinguishes a real empty row from the line terminator that ends a file. */
  #rowStarted = false;
  /** A CR ended a row; the LF that may follow is the same terminator. */
  #pendingLf = false;

  constructor(delimiter: string | null) {
    this.#delimiter = delimiter;
  }

  *push(text: string): Generator<string[]> {
    let input = text;

    if (this.#atStart) {
      this.#atStart = false;
      // TextDecoder strips a BOM it decodes itself, but a caller feeding us
      // strings has already done the decoding and may not have.
      if (input.startsWith(BOM)) input = input.slice(1);
    }

    if (this.#delimiter === null) {
      this.#buffered += input;
      const end = firstLineEnd(this.#buffered);
      if (end === -1 && this.#buffered.length < MAX_SNIFF_BYTES) return;

      this.#delimiter = sniffDelimiter(end === -1 ? this.#buffered : this.#buffered.slice(0, end));
      input = this.#buffered;
      this.#buffered = '';
    }

    yield* this.#consume(input);
  }

  /** Flush whatever the last chunk left behind — files rarely end tidily. */
  *end(): Generator<string[]> {
    if (this.#delimiter === null) {
      this.#delimiter = sniffDelimiter(this.#buffered);
      const pending = this.#buffered;
      this.#buffered = '';
      yield* this.#consume(pending);
    }

    if (this.#rowStarted || this.#row.length > 0 || this.#field.length > 0) {
      this.#endField();
      const row = this.#endRow();
      if (row !== null) yield row;
    }
  }

  /**
   * Characters are appended in slices rather than one at a time: `mark` tracks
   * where the current run of ordinary characters began, and only a delimiter,
   * a quote or a line break forces a copy. On a 600 MB file the difference
   * between this and `field += ch` is minutes.
   */
  *#consume(text: string): Generator<string[]> {
    let mark = 0;

    for (let i = 0; i < text.length; i++) {
      const ch = text.charAt(i);

      if (this.#state === 'quoted') {
        if (ch === '"') {
          this.#field += text.slice(mark, i);
          mark = i + 1;
          this.#state = 'quote';
        }
        continue; // delimiters and line breaks are ordinary text in here
      }

      if (this.#state === 'quote') {
        if (ch === '"') {
          this.#field += '"'; // `""` is one literal quote
          mark = i + 1;
          this.#state = 'quoted';
          continue;
        }
        // A single quote closed the field. Whatever follows is plain text —
        // `"a"b` is malformed, but every real parser reads it as `ab`.
        this.#state = 'plain';
        mark = i;
      }

      if (ch === '\n' && this.#pendingLf) {
        this.#pendingLf = false; // second half of a CRLF, not a second row
        mark = i + 1;
        continue;
      }
      this.#pendingLf = false;

      if (ch === this.#delimiter) {
        this.#field += text.slice(mark, i);
        this.#endField();
        mark = i + 1;
        this.#state = 'start';
        continue;
      }

      if (ch === '\n' || ch === '\r') {
        this.#field += text.slice(mark, i);
        this.#endField();
        const row = this.#endRow();
        if (row !== null) yield row;
        mark = i + 1;
        this.#pendingLf = ch === '\r';
        continue;
      }

      this.#rowStarted = true;

      if (ch === '"' && this.#state === 'start') {
        mark = i + 1; // the quote itself is syntax, not content
        this.#state = 'quoted';
        continue;
      }

      this.#state = 'plain';
    }

    this.#field += text.slice(mark);
  }

  #endField(): void {
    this.#row.push(this.#field);
    this.#field = '';
  }

  /** Null for a bare line terminator, which is not a row. */
  #endRow(): string[] | null {
    const started = this.#rowStarted;
    const row = this.#row;

    this.#row = [];
    this.#rowStarted = false;
    this.#state = 'start';

    // Files end with a newline, and blank lines turn up in the middle of
    // hand-edited exports. Counting either as a row would report a phantom
    // empty address in the summary.
    if (!started && row.length === 1 && row[0] === '') return null;
    return row;
  }
}

/** Index of the first line terminator that is not inside quotes, or -1. */
function firstLineEnd(text: string): number {
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text.charAt(i);
    if (ch === '"') {
      quoted = !quoted;
      continue;
    }
    if (!quoted && (ch === '\n' || ch === '\r')) return i;
  }

  return -1;
}

/**
 * Whichever candidate appears most often outside quotes wins. Counting beats
 * guessing from the file extension: a `.csv` exported from a German Excel is
 * semicolon-delimited, and reading it with commas yields one column whose
 * every value contains an `@`, which then validates fine and is wrong.
 */
function sniffDelimiter(headerLine: string): string {
  let best = ',';
  let bestCount = 0;

  for (const candidate of DELIMITERS) {
    const count = countOutsideQuotes(headerLine, candidate);
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }

  return best;
}

function countOutsideQuotes(text: string, needle: string): number {
  let quoted = false;
  let count = 0;

  for (let i = 0; i < text.length; i++) {
    const ch = text.charAt(i);
    if (ch === '"') {
      quoted = !quoted;
      continue;
    }
    if (!quoted && ch === needle) count++;
  }

  return count;
}
