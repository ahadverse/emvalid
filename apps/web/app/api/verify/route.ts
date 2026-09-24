import { guardAnonymous, json, jsonError, readJson, withErrors } from '@/lib/http';
import { inspectAddress, readEmailInput } from '@/lib/validator';

/**
 * The dashboard's single-address check.
 *
 * POST { email: string } → { result: EmailResult, checks: Check[] }
 *
 * The audit trail rides along here and not on /api/v1/verify: this response
 * is read by a person looking at a report, that one is read by a program
 * writing a row.
 *
 * Separate from /api/v1/verify on purpose: that one is key-scoped and charges
 * a credit. This one is the demo on the public landing page — deliberately
 * unauthenticated, deliberately free, and rate limited by IP because that is
 * the only handle an anonymous caller offers.
 *
 * It stays free because it is the argument for the product: one address, fully
 * explained, is what convinces somebody the bulk run is worth paying for.
 * Bulk is where the meter runs. Both routes call the same engine — see
 * lib/validator.ts — so the answers cannot diverge.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = withErrors(async (request) => {
  const guard = guardAnonymous(request);
  if (!guard.ok) return guard.response;

  const input = readEmailInput(await readJson(request));
  if (!input.ok) return jsonError('invalid_request', input.message, 400, guard.headers);

  return json(await inspectAddress(input.email), 200, guard.headers);
});
