import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, relative, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { DATA_DIR } from '@/lib/config';
import { guardUi, jsonError, withErrors } from '@/lib/http';
import { getJobOutputPath } from '@/lib/jobs';

/**
 * Feature 17 — download the result file.
 *
 * GET /api/jobs/:id/download → text/csv, streamed
 *
 * Streamed rather than read: the result of a ten-million-row job is larger
 * than the input, and buffering it would undo everything the upload path does.
 *
 * This is the most sensitive route in the app — the response body is the
 * customer's list. It was open to anyone holding a job id before v2; now the
 * lookup is scoped to the signed-in owner, so another account's id is a 404.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Context {
  params: Promise<{ id: string }>;
}

export const GET = withErrors(async (request: Request, context: Context) => {
  const guard = await guardUi(request);
  if (!guard.ok) return guard.response;

  const { id } = await context.params;

  const output = await getJobOutputPath(guard.user.id, id);
  if (output === null) {
    return jsonError('not_found', 'No result file for this job.', 404);
  }

  // The path comes from our own row, but a path traversal here would serve any
  // file on the box, so it is verified rather than trusted.
  const root = resolve(DATA_DIR);
  const path = resolve(output.path);
  const within = relative(root, path);
  if (within.startsWith('..') || within === '') {
    console.error('job output path escapes DATA_DIR', { jobId: id });
    return jsonError('not_found', 'No result file for this job.', 404);
  }

  let size: number;
  try {
    const info = await stat(path);
    if (!info.isFile()) throw new Error('not a file');
    size = info.size;
  } catch {
    // Retention (feature 24) may have removed it, which is not an error the
    // user needs a stack trace for.
    return jsonError('gone', 'The result file has been deleted by data retention.', 410);
  }

  const stream = Readable.toWeb(createReadStream(path)) as ReadableStream<Uint8Array>;

  // Feature 32 — the file on disk already carries the format the job was run
  // with (worker/src/index.ts picks the extension from `job.resultFormat`),
  // so reading it back here is the one place that needs to know, rather than
  // this route also taking a dependency on the job row's format column.
  const format = extname(path).slice(1);

  return new Response(stream, {
    headers: {
      'Content-Type': CONTENT_TYPES[format] ?? 'application/octet-stream',
      'Content-Length': String(size),
      'Content-Disposition': contentDisposition(resultFilename(output.originalFilename, format)),
      'Cache-Control': 'no-store',
    },
  });
});

const CONTENT_TYPES: Record<string, string> = {
  csv: 'text/csv; charset=utf-8',
  json: 'application/json; charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

function resultFilename(original: string, format: string): string {
  const base = original.replace(/\.[^.]+$/, '');
  return `${base || 'results'}-verified.${format}`;
}

/**
 * Two filenames, on purpose: a stripped ASCII one every client understands,
 * and an RFC 5987 one for anything non-ASCII. The strip is also what stops a
 * quote or a newline in a user-supplied name from injecting a header.
 */
function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
