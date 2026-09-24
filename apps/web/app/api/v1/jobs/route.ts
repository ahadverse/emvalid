import { creditBalance } from '@ev/db';
import { MIN_CREDITS_TO_UPLOAD } from '@/lib/config';
import { guardApi, json, jsonError, withErrors } from '@/lib/http';
import { listJobs } from '@/lib/jobs';
import { handleUpload, UploadError } from '@/lib/upload';

/**
 * Bulk jobs over the public API.
 *
 * GET  /api/v1/jobs            → { jobs: JobRecord[] }   (newest first, max 100)
 * POST /api/v1/jobs            → 201 JobRecord
 *        multipart/form-data, one file part named anything, CSV or XLSX.
 *
 * POST shares lib/upload.ts with the dashboard route, so the size limit and
 * the streaming behaviour are identical whichever door the file comes through.
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

  // Same gate as the dashboard's upload route: the exact row count is unknown
  // until the worker reads the file, so all this can refuse is an account with
  // nothing left. The per-row charge happens in the worker.
  if ((await creditBalance(guard.identity.userId)) < MIN_CREDITS_TO_UPLOAD) {
    return jsonError(
      'insufficient_credits',
      'No verification credits left on this account. Buy a plan to continue.',
      402,
      guard.headers,
    );
  }

  try {
    const { job } = await handleUpload(request, guard.identity.userId);
    return json(job, 201, { ...guard.headers, Location: `/api/v1/jobs/${job.id}` });
  } catch (error) {
    if (error instanceof UploadError) {
      return jsonError('upload_failed', error.message, error.status, guard.headers);
    }
    throw error;
  }
});
