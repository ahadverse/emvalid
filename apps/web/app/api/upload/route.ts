import { creditBalance } from '@ev/db';
import { MIN_CREDITS_TO_UPLOAD } from '@/lib/config';
import { guardUi, json, jsonError } from '@/lib/http';
import { handleUpload, UploadError } from '@/lib/upload';

/**
 * Feature 14 — the dashboard's upload endpoint.
 *
 * POST multipart/form-data with one file part → { jobId, filename, bytes }.
 *
 * The body is read as a stream (see lib/multipart.ts): `request.formData()`
 * would buffer the whole file, and the whole point of this product is that a
 * 600 MB list is ordinary.
 *
 * Feature 27 — the quota gate is here, before a single byte is written. The
 * balance cannot be checked exactly at this point, because nobody knows how
 * many rows the file holds until the worker has read it; what this refuses is
 * an account with nothing left, which is the case that would otherwise fill
 * the disk with work it can never be charged for.
 */

// Streaming to disk needs Node's fs and the Node request body.
export const runtime = 'nodejs';
// Nothing here is cacheable and the body must not be collected up front.
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  const guard = await guardUi(request);
  if (!guard.ok) return guard.response;

  const balance = await creditBalance(guard.user.id);
  if (balance < MIN_CREDITS_TO_UPLOAD) {
    return jsonError(
      'insufficient_credits',
      'This account has no verification credits left. Buy a plan to continue.',
      402,
      guard.headers,
    );
  }

  try {
    const { job, bytes } = await handleUpload(request, guard.user.id);

    return json(
      {
        jobId: job.id,
        filename: job.originalFilename,
        bytes,
        status: job.status,
        creditsRemaining: balance,
      },
      201,
      { ...guard.headers, Location: `/jobs/${job.id}` },
    );
  } catch (error) {
    if (error instanceof UploadError) {
      return jsonError('upload_failed', error.message, error.status, guard.headers);
    }
    console.error('upload failed', error);
    return jsonError('internal_error', 'Upload could not be stored.', 500, guard.headers);
  }
}
