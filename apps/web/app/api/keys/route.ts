import { createApiKey, listApiKeys, normalizeKeyName } from '@/lib/api-keys';
import { guardUi, json, readJson, withErrors } from '@/lib/http';

/**
 * Key management for the dashboard (feature 20).
 *
 * GET  /api/keys           → { keys: ApiKeySummary[] }
 * POST /api/keys { name }  → 201 CreatedApiKey — the ONLY response that ever
 *                            contains `raw`. It is not stored anywhere we can
 *                            read it back from, so a lost key means a new key.
 *
 * Both are scoped to the signed-in account. Before v2 they were scoped to a
 * hardcoded owner and open to anyone who found the URL, which meant an
 * unauthenticated POST here minted a working API key.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withErrors(async (request) => {
  const guard = await guardUi(request);
  if (!guard.ok) return guard.response;

  return json({ keys: await listApiKeys(guard.user.id) }, 200, {
    ...guard.headers,
    'Cache-Control': 'no-store',
  });
});

export const POST = withErrors(async (request) => {
  const guard = await guardUi(request);
  if (!guard.ok) return guard.response;

  const body = await readJson(request);
  const name = normalizeKeyName((body as { name?: unknown } | null)?.name);

  const created = await createApiKey(guard.user.id, name);
  return json(created, 201, { ...guard.headers, 'Cache-Control': 'no-store' });
});
