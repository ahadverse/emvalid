import { extname } from 'node:path';
import { guardUi, jsonError, withErrors } from '@/lib/http';
import { getJobOutputKey } from '@/lib/jobs';
import { getStorage, isStorageKey } from '@/lib/storage';

/**
 * Feature 17 — download the result file.
 *
 * GET /api/jobs/:id/download → 302 to a short-lived signed URL.
 *
 * A redirect rather than a proxied stream. The result of a ten-million-row job
 * is larger than the input, and a serverless function that streamed it would
 * pay for every byte twice and time out before the slow half of them arrived.
 * The signed URL expires in minutes and names one object, so handing it to the
 * browser gives away nothing a download would not have.
 *
 * This is still the most sensitive route in the app — what is on the other end
 * of that redirect is the customer's list. The lookup is scoped to the
 * signed-in owner, so another account's job id is a 404, and the key is checked
 * before it is signed.
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

  const output = await getJobOutputKey(guard.user.id, id);
  if (output === null) {
    return jsonError('not_found', 'No result file for this job.', 404, guard.headers);
  }

  /*
   * The key comes from our own row, but signing whatever it holds would make
   * one bad write anywhere upstream into a way to read any object in the
   * bucket. It is verified rather than trusted — which also quarantines rows
   * written before the move to object storage, whose absolute filesystem paths
   * point at a machine that no longer exists.
   */
  if (!isStorageKey(output.key)) {
    console.error('job output key is not a storage key', { jobId: id });
    return jsonError('gone', 'The result file is no longer available.', 410, guard.headers);
  }

  const storage = getStorage();

  // Asked before signing so retention (feature 24) produces a 410 the UI can
  // explain, rather than a redirect to a 404 from the bucket.
  if ((await storage.head(output.key)) === null) {
    return jsonError(
      'gone',
      'The result file has been deleted by data retention.',
      410,
      guard.headers,
    );
  }

  // Feature 32 — the stored object already carries the format the job was run
  // with (worker/src/index.ts picks the extension from `job.resultFormat`), so
  // reading it back here is the one place that needs to know.
  const format = extname(output.key).slice(1);

  const url = await storage.presignDownload(output.key, {
    filename: resultFilename(output.originalFilename, format),
    contentType: CONTENT_TYPES[format] ?? 'application/octet-stream',
  });

  return new Response(null, {
    status: 302,
    headers: { ...guard.headers, Location: url, 'Cache-Control': 'no-store' },
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
