import { guardApi, json, jsonError, withErrors } from '@/lib/http';
import { numberField, readJsonBody, stringField } from '@/lib/json-body';
import { planUpload, requireCredits, UploadError } from '@/lib/upload';

/**
 * Direct uploads over the public API — the door a large list has to use.
 *
 * POST /api/v1/uploads  { filename, bytes? }
 *   → { uploadId, url, method, headers, expiresInSeconds }
 *
 * The client PUTs the file at `url`, then POSTs `{ uploadId, filename }` to
 * /api/v1/jobs to queue it. `POST /api/v1/jobs` still accepts a plain
 * multipart body, but that one passes through a serverless function whose
 * request body is capped at a few megabytes; this one does not pass through us
 * at all, so the only ceiling is the account's own.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = withErrors(async (request: Request) => {
  const guard = await guardApi(request);
  if (!guard.ok) return guard.response;

  const body = await readJsonBody(request);
  const filename = stringField(body, 'filename');
  if (filename === null) {
    return jsonError('bad_request', 'A filename is required.', 400, guard.headers);
  }

  try {
    const creditsRemaining = await requireCredits(guard.identity.userId);
    const planned = await planUpload(
      guard.identity.userId,
      filename,
      numberField(body, 'bytes'),
    );

    return json(
      {
        uploadId: planned.uploadId,
        url: planned.upload.url,
        method: planned.upload.method,
        headers: planned.upload.headers,
        expiresInSeconds: planned.upload.expiresInSeconds,
        maxBytes: planned.maxBytes,
        creditsRemaining,
      },
      200,
      guard.headers,
    );
  } catch (error) {
    if (error instanceof UploadError) {
      return jsonError(error.code, error.message, error.status, guard.headers);
    }
    throw error;
  }
});
