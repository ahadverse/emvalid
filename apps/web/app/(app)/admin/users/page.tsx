import { listUsersForAdmin } from '@ev/db';
import { formatCount, formatDateTime } from '@/lib/format';
import { taka } from '@/lib/plans';
import { requireAdmin } from '@/lib/session';
import { UserActions } from '@/components/admin-actions';
import { Search, Shield } from '@/components/icons';
import { Card, Chip, EmptyState, INPUT, PageHeader } from '@/components/ui';

export const metadata = { title: 'Users · Admin' };
export const dynamic = 'force-dynamic';

interface Props {
  searchParams: Promise<{ q?: string | string[] }>;
}

/**
 * Every account, with the two numbers an operator asks for next: how much have
 * they run, and how much have they paid.
 *
 * Search is a plain GET form, not a client component. It has no state worth
 * keeping in JavaScript, and a URL that carries the query is one that can be
 * bookmarked, shared and reloaded.
 */
export default async function AdminUsersPage({ searchParams }: Props) {
  const current = await requireAdmin('/admin/users');

  const params = await searchParams;
  const search = (Array.isArray(params.q) ? params.q[0] : params.q) ?? '';
  const users = await listUsersForAdmin({ search });

  return (
    <div>
      <PageHeader
        title="Users"
        description="Every account on this deployment, newest first."
        action={
          <form method="GET" className="flex w-full max-w-xs items-center gap-2">
            <div className="relative flex-1">
              <Search
                aria-hidden
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle"
              />
              <input
                type="search"
                name="q"
                defaultValue={search}
                placeholder="Email or name"
                aria-label="Search accounts"
                className={`${INPUT} pl-9`}
              />
            </div>
          </form>
        }
      />

      <Card>
        {users.length === 0 ? (
          <EmptyState title={search.length > 0 ? 'No matching accounts' : 'No accounts yet'} icon={Shield}>
            {search.length > 0
              ? 'Nothing matched that search.'
              : 'Accounts appear here as people sign up.'}
          </EmptyState>
        ) : (
          <div className="scroll-x">
            <table className="w-full min-w-4xl text-sm">
              <thead>
                <tr className="border-b border-line bg-surface-sunken text-left text-[11px] uppercase tracking-wider text-ink-subtle">
                  <th className="px-5 py-2.5 font-semibold">Account</th>
                  <th className="px-5 py-2.5 text-right font-semibold">Credits</th>
                  <th className="px-5 py-2.5 text-right font-semibold">Jobs</th>
                  <th className="px-5 py-2.5 text-right font-semibold">Paid</th>
                  <th className="px-5 py-2.5 font-semibold">Joined</th>
                  <th className="px-5 py-2.5 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {users.map((user) => (
                  <tr
                    key={user.id}
                    className={
                      user.status === 'suspended'
                        ? 'opacity-60'
                        : 'transition-colors hover:bg-surface-sunken'
                    }
                  >
                    <td className="px-5 py-3.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-ink">{user.name ?? user.email}</span>
                        {user.role === 'admin' && (
                          <Chip className="bg-accent-soft text-accent ring-1 ring-accent/25">
                            Admin
                          </Chip>
                        )}
                        {user.status === 'suspended' && (
                          <Chip className="bg-bad-soft text-bad ring-1 ring-bad/25">Suspended</Chip>
                        )}
                        {user.id === current.id && (
                          <Chip className="bg-mute-soft text-mute ring-1 ring-mute/25">You</Chip>
                        )}
                      </div>
                      {user.name !== null && (
                        <span className="text-xs text-ink-subtle">{user.email}</span>
                      )}
                    </td>
                    <td className="px-5 py-3.5 text-right tabular-nums text-ink-muted">
                      {formatCount(user.credits)}
                    </td>
                    <td className="px-5 py-3.5 text-right tabular-nums text-ink-muted">
                      {formatCount(user.jobCount)}
                    </td>
                    <td className="px-5 py-3.5 text-right tabular-nums text-ink-muted">
                      {taka(user.paidTaka)}
                    </td>
                    <td className="whitespace-nowrap px-5 py-3.5 text-ink-muted">
                      {formatDateTime(user.createdAt)}
                    </td>
                    <td className="px-5 py-3.5">
                      {/*
                        No self-service on your own row. Demoting or suspending
                        yourself is never the intended click, and the server
                        would refuse it anyway when you are the last admin —
                        better not to offer the button.
                      */}
                      {user.id === current.id ? (
                        <p className="text-right text-xs text-ink-subtle">—</p>
                      ) : (
                        <UserActions userId={user.id} role={user.role} status={user.status} />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
