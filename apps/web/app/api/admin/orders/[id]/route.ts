import { cancelOrder, markOrderPaid, OrderNotPendingError } from '@ev/db';
import { guardAdmin, json, jsonError, readJson, withErrors } from '@/lib/http';

/**
 * Settling an order — the one route in this product where money becomes
 * capability.
 *
 * POST /api/admin/orders/:id { action: 'mark_paid' | 'cancel', reference? }
 *
 * Admin only, and idempotent underneath: `markOrderPaid` matches on
 * `status = 'pending'`, so a double click, an impatient retry or two admins
 * acting at once can only grant the credits once. That property lives in the
 * database query rather than in this handler on purpose — it has to hold for a
 * gateway webhook too, and a webhook will not go through this file.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Context {
  params: Promise<{ id: string }>;
}

export const POST = withErrors(async (request: Request, context: Context) => {
  const guard = await guardAdmin(request);
  if (!guard.ok) return guard.response;

  const { id } = await context.params;
  const body = (await readJson(request)) as { action?: unknown; reference?: unknown } | null;

  const action = typeof body?.action === 'string' ? body.action : '';
  const reference =
    typeof body?.reference === 'string' && body.reference.trim().length > 0
      ? body.reference.trim().slice(0, 120)
      : null;

  if (action === 'cancel') {
    const cancelled = await cancelOrder(id);
    if (cancelled === null) {
      return jsonError('not_pending', 'Only a pending order can be cancelled.', 409, guard.headers);
    }
    return json({ order: cancelled }, 200, guard.headers);
  }

  if (action !== 'mark_paid') {
    return jsonError(
      'invalid_request',
      'action must be "mark_paid" or "cancel".',
      400,
      guard.headers,
    );
  }

  try {
    const settled = await markOrderPaid(id, {
      settledBy: guard.user.id,
      providerRef: reference,
    });

    return json(
      {
        order: settled.order,
        balance: settled.balance,
        periodEnd: settled.subscription.currentPeriodEnd,
      },
      200,
      guard.headers,
    );
  } catch (error) {
    if (error instanceof OrderNotPendingError) {
      return jsonError(
        'not_pending',
        `This order is already ${error.status}. No credits were granted twice.`,
        409,
        guard.headers,
      );
    }
    throw error;
  }
});
