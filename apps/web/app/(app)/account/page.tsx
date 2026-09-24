import { findSubscription, listLedger, listOrders } from '@ev/db';
import { PAYMENT_ACCOUNT, PAYMENT_CONTACT } from '@/lib/config';
import { formatCount, formatDateTime } from '@/lib/format';
import { planName, taka } from '@/lib/plans';
import { requireUser } from '@/lib/session';
import { BuyPlan } from '@/components/buy-plan';
import { LogoutButton } from '@/components/logout-button';
import { Bolt, Clock, Key, Shield } from '@/components/icons';
import {
  Card,
  CardHeader,
  Chip,
  EmptyState,
  Field,
  Notice,
  PageHeader,
  SectionLabel,
  Stat,
} from '@/components/ui';

export const metadata = { title: 'Account' };
export const dynamic = 'force-dynamic';

/**
 * Features 25-27 from the customer's side: who am I, what have I got left,
 * what have I bought, and how do I buy more.
 *
 * There is no gateway, so the honest flow is: place an order, see what to pay
 * and where, pay it, and an admin confirms. Every one of those steps is on
 * this page rather than in an email nobody can search for.
 */

const ORDER_CHIPS: Record<string, string> = {
  pending: 'bg-warn-soft text-warn ring-1 ring-warn/25',
  paid: 'bg-good-soft text-good ring-1 ring-good/25',
  cancelled: 'bg-mute-soft text-mute ring-1 ring-mute/25',
  refunded: 'bg-mute-soft text-mute ring-1 ring-mute/25',
};

const LEDGER_LABELS: Record<string, string> = {
  signup_grant: 'Trial credits',
  purchase: 'Purchase',
  verification: 'Verification',
  refund: 'Refund',
  admin_adjustment: 'Adjustment',
};

export default async function AccountPage() {
  const user = await requireUser('/account');

  const [subscription, orders, ledger] = await Promise.all([
    findSubscription(user.id),
    listOrders(user.id, 20),
    listLedger(user.id, 20),
  ]);

  const pending = orders.filter((order) => order.status === 'pending');

  return (
    <div className="space-y-10">
      <PageHeader
        title="Account"
        description="Your plan, your remaining credits, and every order against this account."
        action={<LogoutButton />}
      />

      {/* -------------------------------------------------- Overview */}
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Credits left"
          value={formatCount(user.credits)}
          hint="One credit verifies one address"
          icon={Bolt}
          accent={user.credits > 0 ? 'text-ink' : 'text-bad'}
        />
        <Stat
          label="Plan"
          value={subscription === null ? 'None' : planName(subscription.planId)}
          hint={
            subscription === null
              ? 'No plan bought yet'
              : subscription.status === 'active'
                ? `Renews ${formatDateTime(subscription.currentPeriodEnd)}`
                : `Expired ${formatDateTime(subscription.currentPeriodEnd)}`
          }
          icon={Shield}
          accent={subscription?.status === 'active' ? 'text-good' : 'text-ink'}
        />
        <Stat
          label="Pending orders"
          value={formatCount(pending.length)}
          hint={pending.length > 0 ? 'Awaiting payment confirmation' : 'Nothing outstanding'}
          icon={Clock}
          accent={pending.length > 0 ? 'text-warn' : 'text-ink'}
        />
        <Stat
          label="Signed in as"
          value={<span className="break-all text-base">{user.email}</span>}
          hint={user.role === 'admin' ? 'Administrator' : 'Standard account'}
          icon={Key}
        />
      </section>

      {user.credits === 0 && (
        <Notice tone="warn" title="This account cannot start a job">
          Uploads are refused while the balance is zero. Place an order below to add credits — the
          single-address check on the verify page keeps working either way.
        </Notice>
      )}

      {/* -------------------------------------------------- Buy */}
      <section>
        <SectionLabel>Add credits</SectionLabel>
        <Card>
          <CardHeader
            title="Plans"
            description="Credits are added when the payment is confirmed, and do not expire with the billing period."
            icon={Bolt}
          />
          <BuyPlan currentPlanId={subscription?.planId ?? null} />
        </Card>
      </section>

      {/* -------------------------------------------------- How to pay */}
      {pending.length > 0 && (
        <section>
          <SectionLabel>Pay for a pending order</SectionLabel>
          <Card>
            <CardHeader title="How to pay" description="Quote the order id so it can be matched." />
            <div className="space-y-4 px-5 py-5">
              {PAYMENT_ACCOUNT === null ? (
                /*
                  No invented bKash number. A billing page that displays a
                  plausible account nobody owns does not fail safely — it sends
                  a customer's money to a stranger.
                */
                <Notice tone="warn" title="Payment details are not configured yet">
                  This deployment has no <code className="font-mono">PAYMENT_ACCOUNT</code> set, so
                  there is nowhere to send money. Your order is recorded and an administrator can
                  still confirm it manually.
                </Notice>
              ) : (
                <dl className="grid gap-4 sm:grid-cols-2">
                  <Field
                    label="Send to"
                    value={<span className="font-mono">{PAYMENT_ACCOUNT}</span>}
                  />
                  {PAYMENT_CONTACT !== null && (
                    <Field label="Confirm with" value={PAYMENT_CONTACT} />
                  )}
                </dl>
              )}

              <ul className="space-y-2">
                {pending.map((order) => (
                  <li
                    key={order.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warn/30 bg-warn-soft px-4 py-3"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-ink">
                        {planName(order.planId)} · {order.periodMonths === 12 ? 'Yearly' : 'Monthly'}
                      </p>
                      <p className="mt-0.5 font-mono text-xs text-ink-muted">{order.id}</p>
                    </div>
                    <p className="shrink-0 text-lg font-semibold tabular-nums text-ink">
                      {taka(order.amountTaka)}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          </Card>
        </section>
      )}

      {/* -------------------------------------------------- History */}
      <section className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Orders" description="Everything ever placed on this account." />
          {orders.length === 0 ? (
            <EmptyState title="No orders yet" icon={Bolt}>
              Place one above and it will appear here with what to pay.
            </EmptyState>
          ) : (
            <ul className="divide-y divide-line">
              {orders.map((order) => (
                <li key={order.id} className="flex items-start justify-between gap-4 px-5 py-3">
                  <div className="min-w-0">
                    <p className="text-sm text-ink">
                      {planName(order.planId)}
                      <span className="ml-2 text-[13px] text-ink-subtle">
                        {order.periodMonths === 12 ? '12 months' : '1 month'}
                      </span>
                    </p>
                    <p className="mt-0.5 text-xs text-ink-subtle">
                      {formatDateTime(order.createdAt)} · {formatCount(order.credits)} credits
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-sm font-medium tabular-nums text-ink">
                      {taka(order.amountTaka)}
                    </p>
                    <Chip className={`mt-1 ${ORDER_CHIPS[order.status] ?? ''}`}>
                      {order.status}
                    </Chip>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader
            title="Credit history"
            description="Every movement, and what caused it. This is the record of truth for the balance above."
          />
          {ledger.length === 0 ? (
            <EmptyState title="No credit movements yet" icon={Clock} />
          ) : (
            <ul className="divide-y divide-line">
              {ledger.map((entry) => (
                <li key={entry.id} className="flex items-baseline justify-between gap-4 px-5 py-3">
                  <div className="min-w-0">
                    <p className="text-sm text-ink">
                      {LEDGER_LABELS[entry.reason] ?? entry.reason}
                    </p>
                    <p className="mt-0.5 text-xs text-ink-subtle">
                      {formatDateTime(entry.createdAt)}
                    </p>
                  </div>
                  <div className="shrink-0 text-right tabular-nums">
                    <p
                      className={`text-sm font-medium ${entry.delta > 0 ? 'text-good' : 'text-ink-muted'}`}
                    >
                      {entry.delta > 0 ? '+' : ''}
                      {formatCount(entry.delta)}
                    </p>
                    <p className="text-xs text-ink-subtle">{formatCount(entry.balanceAfter)} left</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>
    </div>
  );
}
