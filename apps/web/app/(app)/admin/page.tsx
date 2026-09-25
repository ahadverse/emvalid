import Link from 'next/link';
import { listOrdersForAdmin, platformStats } from '@ev/db';
import { formatCount, formatDateTime } from '@/lib/format';
import { planName, taka } from '@/lib/plans';
import { requireAdmin } from '@/lib/session';
import { OrderActions } from '@/components/admin-actions';
import { Bolt, Check, ChevronRight, Clock, Layers, Shield } from '@/components/icons';
import {
  buttonClass,
  Card,
  CardHeader,
  EmptyState,
  Notice,
  PageHeader,
  SectionLabel,
  Stat,
} from '@/components/ui';

export const metadata = { title: 'Admin' };
export const dynamic = 'force-dynamic';

/**
 * The operator's view.
 *
 * It leads with the pending order queue rather than with the statistics,
 * because that queue is the only thing on this screen with work attached: an
 * order sitting there is a customer who has paid and is waiting. Numbers are
 * context; the queue is the job.
 */
export default async function AdminPage() {
  await requireAdmin('/admin');

  const [stats, pending] = await Promise.all([
    platformStats(),
    listOrdersForAdmin({ status: 'pending', limit: 25 }),
  ]);

  return (
    <div className="space-y-10">
      <PageHeader
        title="Admin"
        description="Settle payments, manage accounts, and see what the platform is actually doing."
        action={
          <Link href="/admin/users" className={buttonClass({ variant: 'secondary' })}>
            All users
            <ChevronRight className="h-4 w-4" />
          </Link>
        }
      />

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Revenue"
          value={taka(stats.revenueTaka)}
          hint={`${formatCount(stats.paidOrders)} paid orders`}
          icon={Bolt}
          accent="text-good"
        />
        <Stat
          label="Awaiting payment"
          value={formatCount(stats.pendingOrders)}
          hint={stats.pendingOrders > 0 ? 'Confirm below once money lands' : 'Queue is clear'}
          icon={Clock}
          accent={stats.pendingOrders > 0 ? 'text-warn' : 'text-ink'}
        />
        <Stat
          label="Accounts"
          value={formatCount(stats.users)}
          hint={`${formatCount(stats.activeUsers)} active · ${formatCount(stats.admins)} admin`}
          icon={Shield}
        />
        <Stat
          label="Jobs run"
          value={formatCount(stats.jobs)}
          hint={`${formatCount(stats.creditsOutstanding)} credits outstanding`}
          icon={Layers}
        />
      </section>

      <section>
        <SectionLabel>Orders awaiting confirmation</SectionLabel>

        <Card>
          <CardHeader
            title="Pending"
            description="Marking one paid grants its credits and extends the account's period, in one transaction."
          />

          {pending.length === 0 ? (
            <EmptyState title="Nothing waiting" icon={Check}>
              Every order placed so far has been settled or cancelled.
            </EmptyState>
          ) : (
            <ul className="divide-y divide-line">
              {pending.map(({ order, userEmail, userName }) => (
                <li key={order.id} className="px-5 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-ink">
                        {userName ?? userEmail}
                        {userName !== null && (
                          <span className="ml-2 font-normal text-ink-subtle">{userEmail}</span>
                        )}
                      </p>
                      <p className="mt-1 text-[13px] text-ink-muted">
                        {planName(order.planId)} ·{' '}
                        {order.periodMonths === 12 ? '12 months' : '1 month'} ·{' '}
                        <span className="font-medium text-ink">{taka(order.amountTaka)}</span> ·{' '}
                        {formatCount(order.credits)} credits
                      </p>
                      <p className="mt-1 font-mono text-xs text-ink-subtle">{order.id}</p>
                      <p className="mt-0.5 text-xs text-ink-subtle">
                        Placed {formatDateTime(order.createdAt)}
                      </p>
                    </div>

                    <OrderActions orderId={order.id} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>

      <section>
        <Notice title="There is no payment gateway">
          Nothing here watches a bank. An order becomes paid because an administrator saw the money
          arrive and said so — and the credits are granted from the amount recorded on the order,
          not from anything the customer typed. Marking the same order paid twice grants nothing the
          second time.
        </Notice>
      </section>
    </div>
  );
}
