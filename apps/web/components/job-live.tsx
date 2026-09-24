'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { JobRecord } from '@/lib/dto';
import { formatCount, formatDateTime, formatDuration, isTerminal } from '@/lib/format';
import { JobProgressBar, JobStatusChip } from './job-bits';
import { SummaryView } from './summary-view';
import { Download, FileIcon } from './icons';
import { buttonClass, Card, Field, Notice } from './ui';

const POLL_INTERVAL_MS = 2000;

/**
 * Live job view.
 *
 * Polling, not a websocket: a job emits one number every few seconds and a
 * socket per open tab would cost more to operate than it saves. The loop is a
 * chained timeout rather than an interval so a slow response cannot stack
 * requests, and it stops dead the moment the job reaches a terminal state —
 * a finished job's row will never change again, so continuing to ask is pure
 * load.
 */
export function JobLive({ initial }: { initial: JobRecord }) {
  const [job, setJob] = useState<JobRecord>(initial);
  const [stale, setStale] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (isTerminal(job.status)) return;

    let cancelled = false;

    async function poll(): Promise<void> {
      try {
        const response = await fetch(`/api/jobs/${initial.id}`, { cache: 'no-store' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const next = (await response.json()) as JobRecord;
        if (cancelled) return;

        setStale(false);
        setJob(next);
        if (isTerminal(next.status)) return;
      } catch {
        // A dropped poll is not a failed job. Keep the last known state on
        // screen, say so, and try again — the worker is unaffected either way.
        if (cancelled) return;
        setStale(true);
      }

      timer.current = setTimeout(poll, POLL_INTERVAL_MS);
    }

    timer.current = setTimeout(poll, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      if (timer.current !== null) clearTimeout(timer.current);
    };
  }, [initial.id, job.status]);

  const duration =
    job.startedAt === null
      ? null
      : new Date(job.finishedAt ?? Date.now()).getTime() - new Date(job.startedAt).getTime();

  const watching = !isTerminal(job.status);

  return (
    <div className="space-y-6">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div className="flex min-w-0 gap-3">
            <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-line bg-surface-sunken text-ink-muted">
              <FileIcon className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <h1 className="truncate text-base font-semibold tracking-tight text-ink">
                {job.originalFilename}
              </h1>
              <p className="mt-0.5 font-mono text-xs text-ink-subtle">{job.id}</p>
            </div>
          </div>

          {job.downloadable && (
            <Link
              href={`/api/jobs/${job.id}/download`}
              prefetch={false}
              className={buttonClass()}
            >
              <Download className="h-4 w-4" />
              Download results
            </Link>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4">
          <JobStatusChip status={job.status} />

          {watching && !stale && (
            <span className="text-[13px] text-ink-subtle">
              Refreshing every {POLL_INTERVAL_MS / 1000} seconds
            </span>
          )}

          {stale && (
            <span className="text-[13px] text-warn">
              Live updates interrupted — showing the last known state.
            </span>
          )}
        </div>

        <div className="px-5 pb-5">
          <JobProgressBar job={job} />
        </div>

        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 border-t border-line px-5 py-4 sm:grid-cols-3 lg:grid-cols-5">
          <Field label="Created" value={formatDateTime(job.createdAt)} />
          <Field label="Started" value={formatDateTime(job.startedAt)} />
          <Field label="Finished" value={formatDateTime(job.finishedAt)} />
          <Field label="Duration" value={duration === null ? '—' : formatDuration(duration)} />
          <Field label="Deleted after" value={formatDateTime(job.expiresAt)} />
        </dl>

        {job.attempts > 1 && (
          <div className="border-t border-line px-5 py-3.5">
            <p className="text-[13px] text-ink-muted">
              Attempt {formatCount(job.attempts)} — an earlier run stalled and the job was picked
              up again.
            </p>
          </div>
        )}
      </Card>

      {job.status === 'failed' && (
        <Notice tone="bad" title="This job failed">
          {job.error ?? 'No further detail was recorded.'}
        </Notice>
      )}

      {job.status === 'cancelled' && (
        <Notice tone="warn" title="This job was cancelled">
          No result file was produced.
        </Notice>
      )}

      {watching && (
        <Notice title="The breakdown appears once the job finishes">
          Counts are accumulated as rows stream past, so nothing is held in memory and a partial
          summary would be misleading.
        </Notice>
      )}

      {job.summary !== null && <SummaryView summary={job.summary} />}
    </div>
  );
}
