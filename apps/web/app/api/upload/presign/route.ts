import { guardUi, json, jsonError, withErrors } from '@/lib/http';
import { numberField, readJsonBody, stringField } from '@/lib/json-body';
import { planUpload, requireCredits, UploadError } from '@/lib/upload';

/**
 * Step one of an upload: ask for somewhere to put the bytes.
 *
 * POST { filename, bytes? } → { uploadId, url, method, headers, expiresInSeconds }
 *
 * The browser then PUTs the file straight at that URL and calls
 * `/api/upload/complete`. Two round trips where one used to do, and the reason
 * is not elegance: a Vercel function cannot receive a request body of more than
 * a few megabytes, and this product's ordinary input is a 600 MB list. The
 * bytes have to bypass us entirely.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = withErrors(async (request: Request) => {
  const guard = await guardUi(request);
  if (!guard.ok) return guard.response;

  const body = await readJsonBody(request);
  const filename = stringField(body, 'filename');
  if (filename === null) {
    return jsonError('bad_request', 'A filename is required.', 400, guard.headers);
  }

  try {
    // Refused before a URL is signed rather than after the file arrives: an
    // account with nothing left should not be handed somewhere to put 600 MB.
    const creditsRemaining = await requireCredits(guard.user.id);
    const planned = await planUpload(guard.user.id, filename, numberField(body, 'bytes'));

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
