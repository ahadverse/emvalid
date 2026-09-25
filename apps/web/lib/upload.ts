import 'server-only';

import { createWriteStream } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { extname, join, resolve } from 'node:path';
import type { ResultFormat } from '@ev/db';
import { DATA_DIR, MAX_UPLOAD_BYTES } from './config';
import { createJob, type JobRecord } from './jobs';
import { MultipartError, readMultipart } from './multipart';

const RESULT_FORMATS = new Set<ResultFormat>(['csv', 'json', 'xlsx']);

/** Anything unrecognised (including absent) quietly falls back to CSV. */
function readResultFormat(fields: Map<string, string>): ResultFormat {
  const raw = fields.get('format');
  return raw !== undefined && RESULT_FORMATS.has(raw as ResultFormat) ? (raw as ResultFormat) : 'csv';
}

/**
 * Feature 14 — take a CSV/XLSX upload and turn it into a queued job.
 *
 * Shared by the dashboard route and the public API route so there is exactly
 * one path a file can enter the system by, and therefore one place where the
 * size limit, the extension check and the storage layout are enforced.
 */

/** XLSX is accepted and stored; the worker decides how to read it. */
const ALLOWED_EXTENSIONS = new Set(['.csv', '.tsv', '.txt', '.xlsx', '.xls']);

export class UploadError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = 'UploadError';
    this.status = status;
  }
}

export interface UploadOutcome {
  job: JobRecord;
  bytes: number;
}

export async function handleUpload(request: Request, userId: string): Promise<UploadOutcome> {
  if (request.body === null) {
    throw new UploadError('Request has no body.');
  }

  // The job id is not known until the row exists, and the row cannot be
  // written until the file has landed — so storage is keyed on its own id.
  // The worker writes its result alongside the input, in this directory.
  const uploadId = randomUUID();
  const directory = join(resolve(DATA_DIR), 'uploads', uploadId);
  await mkdir(directory, { recursive: true });

  let inputPath = '';

  try {
    const result = await readMultipart(request.body, request.headers.get('content-type'), {
      maxFileBytes: MAX_UPLOAD_BYTES,
      openFile: (part) => {
        const extension = safeExtension(part.filename);
        if (!ALLOWED_EXTENSIONS.has(extension)) {
          throw new UploadError(
            `Unsupported file type "${extension || 'unknown'}". Upload a CSV or XLSX file.`,
            415,
          );
        }

        // The uploaded name is never used as a path component — only its
        // extension survives, so a crafted filename cannot escape the directory.
        inputPath = join(directory, `input${extension}`);
        return createWriteStream(inputPath);
      },
    });

    if (result.file === null) {
      throw new UploadError('No file part found in the upload.');
    }
    if (result.file.bytes === 0) {
      throw new UploadError('The uploaded file is empty.');
    }

    // `outputPath` is not set here: it is written by the worker when the job
    // completes, because until then there is no result file to point at and a
    // path in the column would imply otherwise.
    const job = await createJob({
      userId,
      originalFilename: displayName(result.file.filename),
      inputPath,
      resultFormat: readResultFormat(result.fields),
    });

    return { job, bytes: result.file.bytes };
  } catch (error) {
    // A rejected upload must not leave bytes on disk — an oversized file that
    // failed the limit is exactly the file we least want to keep.
    await rm(directory, { recursive: true, force: true }).catch(() => undefined);

    if (error instanceof UploadError) throw error;
    if (error instanceof MultipartError) throw new UploadError(error.message, error.status);
    throw error;
  }
}

/** Lowercased extension of the client-supplied name, with any path stripped. */
function safeExtension(filename: string): string {
  const base = filename.replace(/^.*[\\/]/, '');
  return extname(base).toLowerCase();
}

/** Kept for display only — never touched to build a path. */
function displayName(filename: string): string {
  const base = filename.replace(/^.*[\\/]/, '').trim();
  return base.length === 0 ? 'upload.csv' : base.slice(0, 200);
}
