import {
  countActiveAdmins,
  deleteUserSessions,
  findUserById,
  grantCredits,
  setUserRole,
  setUserStatus,
} from '@ev/db';
import { guardAdmin, json, jsonError, readJson, withErrors } from '@/lib/http';

/**
 * Admin actions on one account.
 *
 * POST /api/admin/users/:id
 *   { action: 'suspend' | 'activate' }
 *   { action: 'set_role', role: 'user' | 'admin' }
 *   { action: 'grant_credits', amount: number, note?: string }
 *
 * Two rules this file exists to enforce, both of which are the kind of thing
 * that is obvious in hindsight at 3am:
 *
 *   · You cannot remove the last way in. Suspending or demoting the final
 *     active admin locks every human out of this area permanently, and the fix
 *     then needs a psql prompt on the production box.
 *   · Suspending someone ends their sessions. A suspension that leaves the
 *     open tab working until the cookie expires in a month is not a
 *     suspension.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Context {
  params: Promise<{ id: string }>;
}

const MAX_GRANT = 10_000_000;

export const POST = withErrors(async (request: Request, context: Context) => {
  const guard = await guardAdmin(request);
  if (!guard.ok) return guard.response;

  const { id } = await context.params;
  const target = await findUserById(id);
  if (target === null) return jsonError('not_found', 'No such user.', 404, guard.headers);

  const body = (await readJson(request)) as {
    action?: unknown;
    role?: unknown;
    amount?: unknown;
    note?: unknown;
  } | null;

  const action = typeof body?.action === 'string' ? body.action : '';

  switch (action) {
    case 'suspend': {
      if (target.role === 'admin' && (await countActiveAdmins()) <= 1) {
        return jsonError(
          'last_admin',
          'This is the only active admin. Promote someone else first.',
          409,
          guard.headers,
        );
      }

      await setUserStatus(target.id, 'suspended');
      // Their open tabs stop working now, not in thirty days.
      const ended = await deleteUserSessions(target.id);

      return json({ status: 'suspended', sessionsEnded: ended }, 200, guard.headers);
    }

    case 'activate': {
      await setUserStatus(target.id, 'active');
      return json({ status: 'active' }, 200, guard.headers);
    }

    case 'set_role': {
      const role = body?.role;
      if (role !== 'user' && role !== 'admin') {
        return jsonError('invalid_request', 'role must be "user" or "admin".', 400, guard.headers);
      }

      if (role === 'user' && target.role === 'admin' && (await countActiveAdmins()) <= 1) {
        return jsonError(
          'last_admin',
          'This is the only active admin. Promote someone else first.',
          409,
          guard.headers,
        );
      }

      await setUserRole(target.id, role);
      return json({ role }, 200, guard.headers);
    }

    case 'grant_credits': {
      const amount = typeof body?.amount === 'number' ? Math.trunc(body.amount) : Number.NaN;

      if (!Number.isInteger(amount) || amount <= 0 || amount > MAX_GRANT) {
        return jsonError(
          'invalid_request',
          `amount must be a whole number between 1 and ${MAX_GRANT.toLocaleString('en-US')}.`,
          400,
          guard.headers,
        );
      }

      const note = typeof body?.note === 'string' ? body.note.trim().slice(0, 200) : '';

      const balance = await grantCredits(
        target.id,
        amount,
        {
          reason: 'admin_adjustment',
          // Who did it, on the ledger row, because "where did these credits
          // come from" is a question that gets asked months later.
          note: `By ${guard.user.email}${note.length > 0 ? ` — ${note}` : ''}`,
        },
      );

      return json({ balance }, 200, guard.headers);
    }

    default:
      return jsonError(
        'invalid_request',
        'action must be one of: suspend, activate, set_role, grant_credits.',
        400,
        guard.headers,
      );
  }
});
