import { Suspense } from 'react';
import Link from 'next/link';
import { formatCount, formatDateTime } from '@/lib/format';
import { listJobs } from '@/lib/jobs';
import { requireUser } from '@/lib/session';
import { DownloadLink, JobProgressBar, JobStatusChip } from '@/components/job-bits';
import { Bolt, ChevronRight, Clock, Layers, Shield } from '@/components/icons';
import { Card, EmptyState, PageHeader, SectionLabel, Skeleton, Stat } from '@/components/ui';

/**
 * Feature 21 — the dashboard.
 *
 * A server component: `listJobs` reaches @ev/db, which must never end up in a
 * client bundle. Nothing here polls; a job in flight is watched on its own
 * page, and a list that refreshed itself every two seconds would keep a
 * connection open for every open tab.
 *
 * The skeleton is an explicit `<Suspense>` rather than a `loading.tsx`, and
 * that distinction is load-bearing. A `loading.tsx` in this segment also wraps
 * `jobs/[id]`, which flushes the response before that page has decided whether
 * the job exists — and once bytes are on the wire the status is committed, so
 * `notFound()` there rendered the right page under a 200. Scoping the boundary
 * to this file's own data keeps `/jobs/<id>` answering 404 when it means it.
 */

export const metadata = { title: 'Jobs' };
export const dynamic = 'force-dynamic';

export default function JobsPage() {
  return (
    <div>
      {/* No "New job" button here — the shell's top bar carries it on every
          page of the dashboard, and two of them on one screen is a reader
          wondering whether they do different things. */}
      <PageHeader
        title="Jobs"
        description="Every list you have uploaded, newest first. Result files are deleted automatically once their retention window passes."
      />

      <Suspense fallback={<JobsSkeleton />}>
        <JobsContent />
      </Suspense>
    </div>
  );
}

async function JobsContent() {
  // The layout above has already resolved the session, so this never actually
  // redirects. It is here so the query cannot be written against the wrong id
  // if this component is ever moved.
  const user = await requireUser('/jobs');
  const jobs = await listJobs(user.id);

  const active = jobs.filter((job) => job.status === 'running' || job.status === 'queued').length;
  const completed = jobs.filter((job) => job.status === 'completed').length;
  const rows = jobs.reduce((sum, job) => sum + job.processedRows, 0);

  return (
    <>
      {jobs.length > 0 && (
        <div className="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Jobs" value={formatCount(jobs.length)} icon={Layers} />
          <Stat
            label="In flight"
            value={formatCount(active)}
            icon={Clock}
            accent={active > 0 ? 'text-accent' : 'text-ink'}
            hint={active > 0 ? 'Open one to watch it run' : 'Nothing queued'}
          />
          <Stat label="Completed" value={formatCount(completed)} icon={Shield} accent="text-good" />
          <Stat
            label="Rows verified"
            value={formatCount(rows)}
            icon={Bolt}
            hint="Across every job on this account"
          />
        </div>
      )}

      <SectionLabel>History</SectionLabel>

      <Card>
        {jobs.length === 0 ? (
          <EmptyState title="No jobs yet" icon={Layers}>
            Upload a CSV or XLSX on the verify page and it will show up here while it runs.
          </EmptyState>
        ) : (
          <div className="scroll-x">
            <table className="w-full min-w-3xl text-sm">
              <thead>
                <tr className="border-b border-line bg-surface-sunken text-left text-[11px] uppercase tracking-wider text-ink-subtle">
                  <th className="px-5 py-2.5 font-semibold">File</th>
                  <th className="px-5 py-2.5 font-semibold">Status</th>
                  <th className="w-56 px-5 py-2.5 font-semibold">Progress</th>
                  <th className="px-5 py-2.5 text-right font-semibold">Rows</th>
                  <th className="px-5 py-2.5 font-semibold">Created</th>
                  <th className="px-5 py-2.5 text-right font-semibold">Result</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {jobs.map((job) => (
                  <tr key={job.id} className="group transition-colors hover:bg-surface-sunken">
                    <td className="max-w-xs px-5 py-3.5">
                      <Link
                        href={`/jobs/${job.id}`}
                        className="flex items-center gap-1.5 font-medium text-ink transition-colors hover:text-accent"
                      >
                        <span className="truncate">{job.originalFilename}</span>
                        <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-70" />
                      </Link>
                      <span className="font-mono text-xs text-ink-subtle">{job.id.slice(0, 8)}</span>
                    </td>
                    <td className="px-5 py-3.5">
                      <JobStatusChip status={job.status} />
                    </td>
                    <td className="px-5 py-3.5">
                      <JobProgressBar job={job} showLabel={false} />
                    </td>
                    <td className="px-5 py-3.5 text-right tabular-nums text-ink-muted">
                      {job.totalRows > 0
                        ? `${formatCount(job.processedRows)} / ${formatCount(job.totalRows)}`
                        : formatCount(job.processedRows)}
                    </td>
                    <td className="whitespace-nowrap px-5 py-3.5 text-ink-muted">
                      {formatDateTime(job.createdAt)}
                    </td>
                    <td className="whitespace-nowrap px-5 py-3.5 text-right">
                      <DownloadLink job={job} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

/** Sized to the real thing, so the swap is not a layout shift. */
function JobsSkeleton() {
  return (
    <>
      <div className="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((index) => (
          <div key={index} className="rounded-xl border border-line bg-surface px-4 py-3.5">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="mt-3 h-6 w-14" />
            <Skeleton className="mt-3 h-3 w-24" />
          </div>
        ))}
      </div>

      <SectionLabel>History</SectionLabel>

      <Card>
        <div className="border-b border-line bg-surface-sunken px-5 py-3">
          <Skeleton className="h-3 w-24" />
        </div>
        <div className="divide-y divide-line">
          {[0, 1, 2, 3, 4].map((index) => (
            <div key={index} className="flex items-center gap-6 px-5 py-4">
              <div className="min-w-0 flex-1">
                <Skeleton className="h-4 w-48" />
                <Skeleton className="mt-1.5 h-3 w-16" />
              </div>
              <Skeleton className="h-5 w-20 rounded-full" />
              <Skeleton className="hidden h-1.5 w-40 sm:block" />
              <Skeleton className="hidden h-4 w-24 md:block" />
            </div>
          ))}
        </div>
      </Card>
    </>
  );
}
