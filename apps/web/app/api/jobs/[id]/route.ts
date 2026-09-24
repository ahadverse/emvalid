import { guardUi, json, jsonError, withErrors } from '@/lib/http';
import { getJob } from '@/lib/jobs';

/**
 * The status endpoint the job page polls (feature 16's UI half).
 *
 * GET /api/jobs/:id → JobRecord
 *
 * Kept out of /api/v1 because the dashboard has no API key to present. The
 * payload is the same JobRecord the public route returns, so the page and an
 * integrator see identical numbers.
 *
 * `getJob` matches on owner as well as id, so another account's job is a 404
 * rather than a 403 — an id must not be probeable for existence.
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
  const job = await getJob(guard.user.id, id);
  if (job === null) return jsonError('not_found', 'No such job.', 404, guard.headers);

  // Polled every two seconds — a cached response would freeze the progress bar.
  return json(job, 200, { ...guard.headers, 'Cache-Control': 'no-store' });
});
