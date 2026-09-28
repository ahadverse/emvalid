import { guardUi, json, jsonError, withErrors } from '@/lib/http';
import { readJsonBody, stringField } from '@/lib/json-body';
import { completeUpload, readResultFormat, UploadError } from '@/lib/upload';

/**
 * Step two of an upload: the bytes are in the bucket, queue the job.
 *
 * POST { uploadId, filename, format? } → 201 { jobId, filename, bytes, status }
 *
 * Nothing here takes the client's word for where the object is. The key is
 * rebuilt from the session's own user id and the upload id, and the size is
 * read back off the stored object — so a client that lies about either gets a
 * key that was never written, and a 409 rather than a job.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = withErrors(async (request: Request) => {
  const guard = await guardUi(request);
  if (!guard.ok) return guard.response;

  const body = await readJsonBody(request);
  const uploadId = stringField(body, 'uploadId');
  const filename = stringField(body, 'filename');

  if (uploadId === null || filename === null) {
    return jsonError('bad_request', 'uploadId and filename are required.', 400, guard.headers);
  }

  try {
    const { job, bytes } = await completeUpload({
      userId: guard.user.id,
      uploadId,
      filename,
      resultFormat: readResultFormat(body['format']),
    });

    return json(
      { jobId: job.id, filename: job.originalFilename, bytes, status: job.status },
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
