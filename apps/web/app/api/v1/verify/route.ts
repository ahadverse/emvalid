import { consumeCredits, InsufficientCreditsError } from '@ev/db';
import { guardApi, json, jsonError, readJson, withErrors } from '@/lib/http';
import { readEmailInput, verifyAddress } from '@/lib/validator';

/**
 * Feature 19 — single email check, public API.
 *
 * POST /api/v1/verify
 *   Authorization: Bearer <api key>
 *   { "email": "someone@example.com" }
 *   → 200 EmailResult (see @ev/core types.ts)
 *
 * The response is core's `EmailResult` verbatim. No field is dropped and none
 * is renamed: a caller that only reads `status` gets an honest answer, and one
 * that reads `confidence`, `reason` and `detail` can write its own policy.
 * Notably `status` will never be "deliverable" — proving a mailbox exists
 * needs SMTP, which this deployment does not do.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = withErrors(async (request) => {
  const guard = await guardApi(request);
  if (!guard.ok) return guard.response;

  const input = readEmailInput(await readJson(request));
  if (!input.ok) return jsonError('invalid_request', input.message, 400, guard.headers);

  /*
   * Charged before the lookup, not after.
   *
   * Charging afterwards means a caller who disconnects mid-request gets the
   * DNS work for free, and at one credit a call that is a trivially
   * automatable way to run the meter backwards. The trade is that a lookup
   * which then fails has still cost a credit — acceptable, because the engine
   * returns a `retry` verdict rather than throwing, so a "failure" here is
   * still an answer the caller receives.
   *
   * Unlike /api/verify on the landing page, which is free and unmetered
   * because it is the demo that sells this one.
   */
  try {
    await consumeCredits(guard.identity.userId, 1, { note: `key ${guard.identity.prefix}` });
  } catch (error) {
    if (error instanceof InsufficientCreditsError) {
      return jsonError(
        'insufficient_credits',
        'No verification credits left on this account. Buy a plan to continue.',
        402,
        guard.headers,
      );
    }
    throw error;
  }

  return json(await verifyAddress(input.email), 200, guard.headers);
});
