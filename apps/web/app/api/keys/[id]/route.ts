import { revokeApiKey } from '@/lib/api-keys';
import { guardUi, json, jsonError, withErrors } from '@/lib/http';

/**
 * DELETE /api/keys/:id → { revoked: true }
 *
 * Revocation, not deletion: the row stays so past usage remains explicable.
 * A second delete on an already-revoked key returns 404, which keeps the
 * operation honest about whether it changed anything.
 *
 * `revokeApiKey` takes the owner's id and matches on it, so a signed-in user
 * naming somebody else's key id gets the same 404 as one naming a key that was
 * never there — the response cannot be used to discover that an id exists.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Context {
  params: Promise<{ id: string }>;
}

export const DELETE = withErrors(async (request: Request, context: Context) => {
  const guard = await guardUi(request);
  if (!guard.ok) return guard.response;

  const { id } = await context.params;

  const revoked = await revokeApiKey(guard.user.id, id);
  if (!revoked) return jsonError('not_found', 'No active key with that id.', 404, guard.headers);

  return json({ revoked: true }, 200, { ...guard.headers, 'Cache-Control': 'no-store' });
});
