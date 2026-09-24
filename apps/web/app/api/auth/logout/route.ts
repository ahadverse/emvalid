import { json, withErrors } from '@/lib/http';
import { endSession } from '@/lib/session';

/**
 * POST /api/auth/logout → { ok: true }
 *
 * POST, never GET. A GET would be followed by any link prefetcher, any
 * antivirus proxy and any `<img>` tag on a page the user visits — all of which
 * would silently sign them out.
 *
 * Always 200, even with no session: "log me out" cannot fail, and reporting
 * that there was nothing to end tells a caller whether a stolen cookie is
 * still live.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = withErrors(async () => {
  await endSession();
  return json({ ok: true }, 200, { 'Cache-Control': 'no-store' });
});
