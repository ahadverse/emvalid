import { listOrders, placeOrder } from '@ev/db';
import { guardUi, json, jsonError, readJson, withErrors } from '@/lib/http';
import { findPlan, MONTHS_CHARGED_YEARLY } from '@/lib/plans';

/**
 * Feature 26 — place an order.
 *
 * GET  /api/orders                       → { orders }
 * POST /api/orders { planId, yearly? }   → 201 { order }
 *
 * The price and the credit count are read from the server's own plan table,
 * never from the request. A client that could name its own `amountTaka` could
 * buy the Scale plan for one taka, and this is the exact shape of bug that
 * turns up in every "we trusted the form" post-mortem.
 *
 * Placing an order grants nothing. It creates a pending row and tells the
 * customer what to pay; an admin marks it paid once the money has arrived, and
 * `markOrderPaid` is where credits and the subscription period actually move.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withErrors(async (request) => {
  const guard = await guardUi(request);
  if (!guard.ok) return guard.response;

  return json({ orders: await listOrders(guard.user.id) }, 200, {
    ...guard.headers,
    'Cache-Control': 'no-store',
  });
});

export const POST = withErrors(async (request) => {
  const guard = await guardUi(request);
  if (!guard.ok) return guard.response;

  const body = (await readJson(request)) as { planId?: unknown; yearly?: unknown } | null;

  const planId = typeof body?.planId === 'string' ? body.planId : '';
  const yearly = body?.yearly === true;

  const plan = findPlan(planId);
  if (plan === undefined) {
    return jsonError('invalid_request', 'No such plan.', 400, guard.headers);
  }

  const periodMonths = yearly ? 12 : 1;
  // Yearly is twelve months of credits for ten months of money. Both numbers
  // are derived from the monthly figures, so a price change cannot leave the
  // annual option quoting a stale total.
  const amountTaka = yearly ? plan.monthly * MONTHS_CHARGED_YEARLY : plan.monthly;
  const credits = plan.quota * periodMonths;

  const order = await placeOrder({
    userId: guard.user.id,
    planId: plan.id,
    periodMonths,
    amountTaka,
    credits,
  });

  return json({ order }, 201, { ...guard.headers, 'Cache-Control': 'no-store' });
});
