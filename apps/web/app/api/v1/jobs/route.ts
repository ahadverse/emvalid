import { guardApi, json, jsonError, withErrors } from '@/lib/http';
import { readJsonBody, stringField } from '@/lib/json-body';
import { listJobs, type JobRecord } from '@/lib/jobs';
import {
  completeUpload,
  handleUpload,
  readResultFormat,
  requireCredits,
  UploadError,
} from '@/lib/upload';

/**
 * Bulk jobs over the public API.
 *
 * GET  /api/v1/jobs            → { jobs: JobRecord[] }   (newest first, max 100)
 * POST /api/v1/jobs            → 201 JobRecord
 *
 * POST takes the file one of two ways, and which one is right depends entirely
 * on size:
 *
 *   multipart/form-data  — one file part, CSV or XLSX. Simple, one request,
 *     and limited by what a serverless function will accept as a request body,
 *     which is a few megabytes.
 *
 *   application/json     — { uploadId, filename, format? } after PUTting the
 *     bytes at a URL from POST /api/v1/uploads. No ceiling but the account's.
 *
 * Both land in lib/upload.ts, so the extension check, the size limit and the
 * key layout are identical whichever door the file comes through.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_LIMIT = 100;

export const GET = withErrors(async (request) => {
  const guard = await guardApi(request);
  if (!guard.ok) return guard.response;

  const requested = Number(new URL(request.url).searchParams.get('limit') ?? '50');
  const limit = Number.isFinite(requested)
    ? Math.min(MAX_LIMIT, Math.max(1, Math.floor(requested)))
    : 50;

  return json({ jobs: await listJobs(guard.identity.userId, limit) }, 200, guard.headers);
});

export const POST = withErrors(async (request) => {
  const guard = await guardApi(request);
  if (!guard.ok) return guard.response;

  try {
    // Same gate as the dashboard's upload route: the exact row count is
    // unknown until the worker reads the file, so all this can refuse is an
    // account with nothing left. The per-row charge happens in the worker.
    await requireCredits(guard.identity.userId);

    const job = isJson(request)
      ? await completeFromBody(request, guard.identity.userId)
      : (await handleUpload(request, guard.identity.userId)).job;

    return json(job, 201, { ...guard.headers, Location: `/api/v1/jobs/${job.id}` });
  } catch (error) {
    if (error instanceof UploadError) {
      return jsonError(error.code, error.message, error.status, guard.headers);
    }
    throw error;
  }
});

function isJson(request: Request): boolean {
  return (request.headers.get('content-type') ?? '').toLowerCase().includes('application/json');
}

async function completeFromBody(request: Request, userId: string): Promise<JobRecord> {
  const body = await readJsonBody(request);
  const uploadId = stringField(body, 'uploadId');
  const filename = stringField(body, 'filename');

  if (uploadId === null || filename === null) {
    throw new UploadError('uploadId and filename are required.', 400, 'bad_request');
  }

  const { job } = await completeUpload({
    userId,
    uploadId,
    filename,
    resultFormat: readResultFormat(body['format']),
  });

  return job;
}
