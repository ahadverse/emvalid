import { guardApi, json, jsonError, withErrors } from '@/lib/http';
import { getJob } from '@/lib/jobs';

/**
 * GET /api/v1/jobs/:id → JobRecord, including the full JobSummary once the
 * job has completed (features 17 and 18).
 *
 * 404 rather than 403 when the job belongs to someone else — an id should not
 * be probeable for existence.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Context {
  params: Promise<{ id: string }>;
}

export const GET = withErrors(async (request: Request, context: Context) => {
  const guard = await guardApi(request);
  if (!guard.ok) return guard.response;

  const { id } = await context.params;
  const job = await getJob(guard.identity.userId, id);
  if (job === null) return jsonError('not_found', 'No such job.', 404, guard.headers);

  return json(job, 200, guard.headers);
});
