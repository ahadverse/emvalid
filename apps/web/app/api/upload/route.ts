import { guardUi, json, jsonError, withErrors } from '@/lib/http';
import { handleUpload, requireCredits, UploadError } from '@/lib/upload';

/**
 * Feature 14 — the multipart upload endpoint.
 *
 * POST multipart/form-data with one file part → { jobId, filename, bytes }.
 *
 * The body is read as a stream (see lib/multipart.ts) and forwarded to object
 * storage without ever being collected: `request.formData()` would buffer the
 * whole file, and the whole point of this product is that a 600 MB list is
 * ordinary.
 *
 * Which is also the catch. Streaming keeps *our* memory flat, but a request
 * body still has to reach us, and on Vercel a function's body is capped at a
 * few megabytes long before this handler runs. So the dashboard no longer uses
 * this route — it goes through `/api/upload/presign` and puts the bytes in the
 * bucket itself. This stays for small multipart posts and for API clients that
 * already work this way.
 */

// Streaming needs the Node request body, not the edge one.
export const runtime = 'nodejs';
// Nothing here is cacheable and the body must not be collected up front.
export const dynamic = 'force-dynamic';

export const POST = withErrors(async (request: Request) => {
  const guard = await guardUi(request);
  if (!guard.ok) return guard.response;

  try {
    const creditsRemaining = await requireCredits(guard.user.id);
    const { job, bytes } = await handleUpload(request, guard.user.id);

    return json(
      {
        jobId: job.id,
        filename: job.originalFilename,
        bytes,
        status: job.status,
        creditsRemaining,
      },
      201,
      { ...guard.headers, Location: `/jobs/${job.id}` },
    );
  } catch (error) {
    if (error instanceof UploadError) {
      return jsonError(error.code, error.message, error.status, guard.headers);
    }
    throw error;
  }
});
