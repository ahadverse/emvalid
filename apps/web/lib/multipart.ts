import 'server-only';

import type { WriteStream } from 'node:fs';

/**
 * A streaming multipart/form-data reader.
 *
 * This exists because `Request.formData()` materialises every part in memory
 * before the handler runs. On a 600 MB list that is 600 MB of heap, and the
 * process dies well before the parse does. Here the file part is written
 * straight through to disk and only a boundary-sized window is ever held.
 *
 * It is deliberately narrow: one file part, small text fields, no nested
 * multipart, no base64 transfer encoding. That is the whole shape of an upload
 * form, and a general parser would be more code to get wrong.
 */

export class MultipartError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = 'MultipartError';
    this.status = status;
  }
}

export interface PartInfo {
  name: string;
  filename: string;
  contentType: string;
}

export interface MultipartOptions {
  /** Called once, when the file part's headers are known and before any bytes. */
  openFile: (info: PartInfo) => Promise<WriteStream> | WriteStream;
  /** Hard ceiling on the file part, enforced as bytes arrive. */
  maxFileBytes: number;
}

export interface MultipartResult {
  fields: Map<string, string>;
  file: (PartInfo & { bytes: number }) | null;
}

/** Non-file parts are form inputs; anything larger than this is not one. */
const MAX_FIELD_BYTES = 64 * 1024;
/** A header block bigger than this is malformed or hostile. */
const MAX_HEADER_BYTES = 16 * 1024;

const CRLF = Buffer.from('\r\n');
const HEADER_END = Buffer.from('\r\n\r\n');

export function boundaryFrom(contentType: string | null): string {
  if (contentType === null || !contentType.toLowerCase().includes('multipart/form-data')) {
    throw new MultipartError('Expected Content-Type: multipart/form-data.', 415);
  }

  // The boundary may be quoted, and parameters may appear in any order.
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  const boundary = (match?.[1] ?? match?.[2])?.trim();
  if (boundary === undefined || boundary.length === 0) {
    throw new MultipartError('Content-Type is missing the multipart boundary.');
  }
  return boundary;
}

type State = 'delimiter' | 'after-delimiter' | 'headers' | 'field' | 'file' | 'done';

export async function readMultipart(
  body: ReadableStream<Uint8Array>,
  contentType: string | null,
  options: MultipartOptions,
): Promise<MultipartResult> {
  const boundary = boundaryFrom(contentType);
  const delimiter = Buffer.from(`\r\n--${boundary}`);

  const fields = new Map<string, string>();
  let file: (PartInfo & { bytes: number }) | null = null;

  // These are written by `drain` and read by the loop that feeds it. The casts
  // are what stop TypeScript narrowing each one to its initial value: it does
  // not model assignments made inside a nested function, so without them
  // `state` would be permanently 'delimiter' and `sink` permanently null.
  let state = 'delimiter' as State;
  // The first boundary in the body has no CRLF in front of it. Pretending one
  // arrived lets a single delimiter pattern match every boundary, first included.
  let buffer: Buffer = Buffer.from(CRLF);

  let partInfo: PartInfo | null = null;
  let fieldChunks: Buffer[] = [];
  let fieldBytes = 0;
  let sink = null as WriteStream | null;
  let fileBytes = 0;

  const reader = body.getReader();

  /**
   * Runs the state machine over whatever is buffered. `final` tells the body
   * states that no more bytes are coming, so a missing closing boundary is an
   * error rather than a wait.
   */
  async function drain(final: boolean): Promise<void> {
    for (;;) {
      if (state === 'done') {
        buffer = Buffer.alloc(0);
        return;
      }

      if (state === 'delimiter') {
        const at = buffer.indexOf(delimiter);
        if (at === -1) {
          if (final) throw new MultipartError('Malformed multipart body: no boundary found.');
          // The preamble is discarded, but a delimiter could straddle the
          // chunk edge, so its length minus one byte has to survive.
          buffer = keepTail(buffer, delimiter.length - 1);
          return;
        }
        buffer = buffer.subarray(at + delimiter.length);
        state = 'after-delimiter';
        continue;
      }

      if (state === 'after-delimiter') {
        if (buffer.length < 2) {
          if (final) throw new MultipartError('Truncated multipart body.');
          return;
        }
        // "--" closes the message; CRLF starts another part.
        if (buffer[0] === 0x2d && buffer[1] === 0x2d) {
          state = 'done';
          continue;
        }
        if (buffer[0] === 0x0d && buffer[1] === 0x0a) {
          buffer = buffer.subarray(2);
          state = 'headers';
          continue;
        }
        throw new MultipartError('Malformed multipart boundary.');
      }

      if (state === 'headers') {
        const at = buffer.indexOf(HEADER_END);
        if (at === -1) {
          if (final) throw new MultipartError('Truncated multipart part headers.');
          if (buffer.length > MAX_HEADER_BYTES) {
            throw new MultipartError('Multipart part headers are too large.', 431);
          }
          return;
        }

        partInfo = parseHeaders(buffer.subarray(0, at).toString('utf8'));
        buffer = buffer.subarray(at + HEADER_END.length);

        if (partInfo.filename === '') {
          fieldChunks = [];
          fieldBytes = 0;
          state = 'field';
        } else {
          if (file !== null) {
            throw new MultipartError('Only one file may be uploaded per request.');
          }
          sink = await options.openFile(partInfo);
          fileBytes = 0;
          state = 'file';
        }
        continue;
      }

      // Both body states share the same scan; only the destination differs.
      let scan = 0;
      let closed = false;

      while (!closed) {
        const at = buffer.indexOf(delimiter, scan);

        if (at === -1) {
          if (final) throw new MultipartError('Truncated multipart body.');

          // Everything except a delimiter-sized window can be released; a
          // delimiter split across two chunks has to still be findable.
          const safe = buffer.length - (delimiter.length - 1);
          if (safe > 0) {
            await consume(buffer.subarray(0, safe));
            buffer = Buffer.from(buffer.subarray(safe));
          }
          return;
        }

        // RFC 2046: a delimiter only counts if CRLF or "--" follows it. Two
        // more bytes are needed to tell a real boundary from content that
        // merely starts the same way, and content is allowed to.
        if (buffer.length < at + delimiter.length + 2) {
          if (final) throw new MultipartError('Truncated multipart body.');

          if (at > 0) {
            await consume(buffer.subarray(0, at));
            buffer = Buffer.from(buffer.subarray(at));
          }
          return;
        }

        const next = buffer[at + delimiter.length];
        const after = buffer[at + delimiter.length + 1];
        const boundaryHere =
          (next === 0x2d && after === 0x2d) || (next === 0x0d && after === 0x0a);

        if (!boundaryHere) {
          // Not a boundary — these bytes belong to the part. Keep looking.
          scan = at + delimiter.length;
          continue;
        }

        await consume(buffer.subarray(0, at));
        buffer = buffer.subarray(at + delimiter.length);
        await closePart();
        state = 'after-delimiter';
        closed = true;
      }
    }
  }

  async function consume(chunk: Buffer): Promise<void> {
    if (chunk.length === 0) return;

    if (state === 'field') {
      fieldBytes += chunk.length;
      if (fieldBytes > MAX_FIELD_BYTES) {
        throw new MultipartError('Form field is too large.', 413);
      }
      fieldChunks.push(Buffer.from(chunk));
      return;
    }

    fileBytes += chunk.length;
    if (fileBytes > options.maxFileBytes) {
      throw new MultipartError('File exceeds the maximum upload size.', 413);
    }
    await write(sink!, chunk);
  }

  async function closePart(): Promise<void> {
    if (state === 'field') {
      fields.set(partInfo!.name, Buffer.concat(fieldChunks).toString('utf8'));
      fieldChunks = [];
      return;
    }

    await endStream(sink!);
    sink = null;
    file = { ...partInfo!, bytes: fileBytes };
  }

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer = buffer.length === 0 ? Buffer.from(value) : Buffer.concat([buffer, value]);
      await drain(false);
      if (state === 'done') {
        // The closing boundary has arrived; anything after it is epilogue we
        // have no use for. Releasing the body now frees the socket.
        await reader.cancel().catch(() => undefined);
        break;
      }
    }

    if (state !== 'done') await drain(true);
  } catch (error) {
    // The half-written file is the caller's to clean up — it owns the path.
    sink?.destroy();
    await reader.cancel().catch(() => undefined);
    throw error;
  }

  return { fields, file };
}

/** Retains the last `n` bytes so a pattern split across chunks still matches. */
function keepTail(buffer: Buffer, n: number): Buffer {
  return buffer.length <= n ? buffer : Buffer.from(buffer.subarray(buffer.length - n));
}

function parseHeaders(raw: string): PartInfo {
  let disposition = '';
  let contentType = 'application/octet-stream';

  for (const line of raw.split('\r\n')) {
    const colon = line.indexOf(':');
    if (colon === -1) continue;

    const name = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (name === 'content-disposition') disposition = value;
    else if (name === 'content-type') contentType = value;
    else if (name === 'content-transfer-encoding' && value.toLowerCase() !== 'binary') {
      // 7bit/8bit/binary are all pass-through; base64 would need decoding and
      // no browser sends it. Better to refuse than to write mangled bytes.
      if (!['7bit', '8bit'].includes(value.toLowerCase())) {
        throw new MultipartError(`Unsupported Content-Transfer-Encoding: ${value}.`);
      }
    }
  }

  if (disposition === '') {
    throw new MultipartError('Multipart part is missing Content-Disposition.');
  }

  return {
    name: quotedParam(disposition, 'name') ?? '',
    filename: quotedParam(disposition, 'filename') ?? '',
    contentType,
  };
}

function quotedParam(header: string, param: string): string | null {
  const match = new RegExp(`${param}\\*?=(?:"([^"]*)"|([^;]*))`, 'i').exec(header);
  const value = match?.[1] ?? match?.[2];
  return value === undefined ? null : value.trim();
}

/**
 * Backpressure. Without the drain wait, a fast client fills the write stream's
 * internal queue and the memory we moved off the request body reappears inside
 * the file stream.
 */
function write(stream: WriteStream, chunk: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    const ok = stream.write(chunk, (error) => {
      if (error) reject(error);
    });
    if (ok) {
      resolve();
      return;
    }

    // A disk error while we are parked on 'drain' would otherwise never wake
    // us, and the request would hang until the client gave up.
    const onDrain = (): void => {
      stream.off('error', onError);
      resolve();
    };
    const onError = (error: Error): void => {
      stream.off('drain', onDrain);
      reject(error);
    };
    stream.once('drain', onDrain);
    stream.once('error', onError);
  });
}

function endStream(stream: WriteStream): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error): void => reject(error);
    stream.once('error', onError);
    stream.end(() => {
      stream.off('error', onError);
      resolve();
    });
  });
}
