import 'server-only';

import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import { PassThrough } from 'node:stream';
import { creditBalance, type ResultFormat } from '@ev/db';
import { MAX_UPLOAD_BYTES, MIN_CREDITS_TO_UPLOAD } from './config';
import { createJob, type JobRecord } from './jobs';
import { MultipartError, readMultipart } from './multipart';
import { getStorage, uploadKey, type PresignedUpload } from './storage';

/**
 * Feature 14 — take a CSV/XLSX upload and turn it into a queued job.
 *
 * There are two doors and they share this file, so the size limit, the
 * extension check and the key layout are enforced in exactly one place:
 *
 *   1. `planUpload` + `completeUpload` — the browser asks for a signed URL,
 *      PUTs the bytes straight at the bucket, then tells us they landed. This
 *      is the only door a large list can come through, because a Vercel
 *      function's request body is capped at a few megabytes and a 600 MB list
 *      is the ordinary case here.
 *
 *   2. `handleUpload` — a multipart POST, streamed through to storage without
 *      touching a disk. Kept for API clients that already post files this way;
 *      the same cap applies to it, so `/api/v1/uploads` exists for anything
 *      bigger.
 *
 * Feature 27 — the quota gate lives in the routes, before either door opens.
 * The balance cannot be checked exactly here: nobody knows how many rows a
 * file holds until the worker has read it. What the gate refuses is an account
 * with nothing left, which is the case that would otherwise fill a bucket with
 * work that can never be charged for.
 */

/** XLSX is accepted and stored; the worker decides how to read it. */
const ALLOWED_EXTENSIONS = new Set(['.csv', '.tsv', '.txt', '.xlsx', '.xls']);

const RESULT_FORMATS = new Set<ResultFormat>(['csv', 'json', 'xlsx']);

export class UploadError extends Error {
  readonly status: number;
  /** Goes out as the API error code, so a caller can branch on it. */
  readonly code: string;

  constructor(message: string, status = 400, code = 'upload_failed') {
    super(message);
    this.name = 'UploadError';
    this.status = status;
    this.code = code;
  }
}

/**
 * Feature 27 — the gate, in one place because three routes open a door.
 *
 * Returns the balance rather than a boolean: the dashboard shows it back to
 * the user on a successful upload, and asking Postgres twice for the same
 * number is the kind of thing that is fine until it is not.
 */
export async function requireCredits(userId: string): Promise<number> {
  const balance = await creditBalance(userId);

  if (balance < MIN_CREDITS_TO_UPLOAD) {
    throw new UploadError(
      'This account has no verification credits left. Buy a plan to continue.',
      402,
      'insufficient_credits',
    );
  }
  return balance;
}

/** Anything unrecognised (including absent) quietly falls back to CSV. */
export function readResultFormat(raw: unknown): ResultFormat {
  return typeof raw === 'string' && RESULT_FORMATS.has(raw as ResultFormat)
    ? (raw as ResultFormat)
    : 'csv';
}

export interface PlannedUpload {
  uploadId: string;
  upload: PresignedUpload;
  maxBytes: number;
}

/**
 * Step one: check what we can before any bytes move, and hand back a URL the
 * client sends them to.
 *
 * `declaredBytes` comes from the client and is therefore advisory — it is
 * refused early as a courtesy, so a user who picked a 4 GB file learns that
 * now rather than after uploading it. The size that actually counts is the one
 * `completeUpload` reads back off the stored object.
 */
export async function planUpload(
  userId: string,
  filename: string,
  declaredBytes?: number,
): Promise<PlannedUpload> {
  const extension = allowedExtension(filename);

  if (declaredBytes !== undefined && declaredBytes > MAX_UPLOAD_BYTES) {
    throw new UploadError(
      `That file is larger than the ${MAX_UPLOAD_BYTES} byte limit.`,
      413,
    );
  }

  const uploadId = randomUUID();
  const upload = await getStorage().presignUpload(uploadKey(userId, uploadId, extension));

  return { uploadId, upload, maxBytes: MAX_UPLOAD_BYTES };
}

export interface CompleteUploadInput {
  userId: string;
  uploadId: string;
  /** The same name used to plan the upload — its extension rebuilds the key. */
  filename: string;
  resultFormat?: ResultFormat;
}

export interface UploadOutcome {
  job: JobRecord;
  bytes: number;
}

/**
 * Step two: confirm the bytes are really there, then queue the job.
 *
 * The key is rebuilt from the session's user id rather than accepted from the
 * request, so the only object this call can reach is one the caller was given
 * a URL for. A mismatched filename produces a key that was never written, and
 * the head below turns that into a 400 rather than a job pointing at nothing.
 */
export async function completeUpload(input: CompleteUploadInput): Promise<UploadOutcome> {
  const extension = allowedExtension(input.filename);

  if (!isUuid(input.uploadId)) {
    throw new UploadError('Unknown upload.', 404);
  }

  const storage = getStorage();
  const key = uploadKey(input.userId, input.uploadId, extension);

  const stored = await storage.head(key);
  if (stored === null) {
    throw new UploadError('The upload was never completed. Send the file, then try again.', 409);
  }

  if (stored.size === 0) {
    await storage.remove(key).catch(() => undefined);
    throw new UploadError('The uploaded file is empty.');
  }

  // The real enforcement point. A signed URL cannot cap what a client PUTs
  // through it, so an oversized object is refused here — and destroyed, since
  // a file we have already refused is the one we least want to keep.
  if (stored.size > MAX_UPLOAD_BYTES) {
    await storage.remove(key).catch(() => undefined);
    throw new UploadError(`That file is larger than the ${MAX_UPLOAD_BYTES} byte limit.`, 413);
  }

  const job = await createJob({
    userId: input.userId,
    originalFilename: displayName(input.filename),
    inputPath: key,
    ...(input.resultFormat === undefined ? {} : { resultFormat: input.resultFormat }),
  });

  return { job, bytes: stored.size };
}

/**
 * The multipart door. Streams the file part straight into storage: nothing is
 * buffered, nothing touches a disk, and the running process never holds more
 * than a boundary-sized window of the body.
 */
export async function handleUpload(request: Request, userId: string): Promise<UploadOutcome> {
  if (request.body === null) {
    throw new UploadError('Request has no body.');
  }

  const storage = getStorage();
  const uploadId = randomUUID();

  /*
   * Filled in from inside `openFile`, and held in an object rather than three
   * `let`s so the failure path below can still see them: a variable only ever
   * assigned inside a callback reads as never-assigned to the compiler, which
   * would quietly turn the cleanup into dead code.
   */
  const pending: {
    key: string | null;
    sink: PassThrough | null;
    sending: Promise<void> | null;
  } = { key: null, sink: null, sending: null };

  try {
    const result = await readMultipart(request.body, request.headers.get('content-type'), {
      maxFileBytes: MAX_UPLOAD_BYTES,
      openFile: (part) => {
        // The client-supplied name is never a path component — only its
        // extension survives into the key.
        const key = uploadKey(userId, uploadId, allowedExtension(part.filename));
        const sink = new PassThrough();

        // Started, not awaited. The parser writes into the PassThrough as the
        // body arrives, so something has to already be reading from it or the
        // very first chunk deadlocks. It is awaited below, once the parser has
        // ended the stream.
        const sending = storage.put(key, sink);
        // Until that await, a rejection here has no handler and would take the
        // process down. The real outcome is still read from `sending`.
        sending.catch(() => undefined);

        pending.key = key;
        pending.sink = sink;
        pending.sending = sending;
        return sink;
      },
    });

    if (pending.key === null || result.file === null) {
      throw new UploadError('No file part found in the upload.');
    }

    // readMultipart ends the sink when the part is over; this is where the
    // upload of those bytes actually finishes.
    await pending.sending;

    if (result.file.bytes === 0) {
      throw new UploadError('The uploaded file is empty.');
    }

    const job = await createJob({
      userId,
      originalFilename: displayName(result.file.filename),
      inputPath: pending.key,
      resultFormat: readResultFormat(result.fields.get('format')),
    });

    return { job, bytes: result.file.bytes };
  } catch (error) {
    // A rejected upload must not leave bytes in the bucket — an oversized file
    // that failed the limit is exactly the one we least want to keep.
    pending.sink?.destroy();
    await pending.sending?.catch(() => undefined);
    if (pending.key !== null) await storage.remove(pending.key).catch(() => undefined);

    if (error instanceof UploadError) throw error;
    if (error instanceof MultipartError) throw new UploadError(error.message, error.status);
    throw error;
  }
}

/** Lowercased extension of the client-supplied name, with any path stripped. */
function allowedExtension(filename: string): string {
  const base = filename.replace(/^.*[\\/]/, '');
  const extension = extname(base).toLowerCase();

  if (!ALLOWED_EXTENSIONS.has(extension)) {
    throw new UploadError(
      `Unsupported file type "${extension || 'unknown'}". Upload a CSV or XLSX file.`,
      415,
    );
  }
  return extension;
}

/** Kept for display only — never touched to build a key. */
function displayName(filename: string): string {
  const base = filename.replace(/^.*[\\/]/, '').trim();
  return base.length === 0 ? 'upload.csv' : base.slice(0, 200);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: string): boolean {
  return UUID.test(value);
}
