import Link from 'next/link';
import type { JobRecord } from '@/lib/dto';
import { formatCount, JOB_STATUS_STYLES, progressPercent } from '@/lib/format';
import { Download } from './icons';
import { Chip } from './ui';

/**
 * Pieces shared between the job list (server-rendered) and the job detail page
 * (which re-renders them from polled data). Same component, same numbers,
 * whichever side is driving.
 */

export function JobStatusChip({ status }: { status: JobRecord['status'] }) {
  const style = JOB_STATUS_STYLES[status];
  const live = status === 'running';

  return (
    <Chip className={style.chip}>
      {/*
        A running job is the only state that will change on its own, so it is
        the only one that gets a moving indicator. Everything else is a static
        dot — animation that means nothing is animation a reader learns to
        ignore, including on the row where it did mean something.
      */}
      <span aria-hidden className="relative grid h-1.5 w-1.5 place-items-center">
        {live && (
          <span className="absolute h-1.5 w-1.5 animate-ping-slow rounded-full bg-current opacity-70" />
        )}
        <span className="h-1.5 w-1.5 rounded-full bg-current" />
      </span>
      {style.label}
    </Chip>
  );
}

/**
 * `totalRows` is 0 until the worker has read the file, so there is a real
 * "we do not know yet" state. It gets an indeterminate bar rather than a
 * fabricated percentage.
 *
 * Completed is the exception, and it is not a fabrication: a job that
 * finished read every row it was ever going to, so it is full by definition
 * even when no total was ever written down. `complete()` now records one, but
 * jobs that finished before it did still land here — and a "Completed" chip
 * above a third-full bar reads as a broken job, which is the opposite of what
 * happened.
 */
export function JobProgressBar({
  job,
  showLabel = true,
}: {
  job: Pick<JobRecord, 'status' | 'processedRows' | 'totalRows'>;
  showLabel?: boolean;
}) {
  const percent = progressPercent(job.processedRows, job.totalRows);
  const running = job.status === 'running' || job.status === 'queued';
  const done = job.status === 'completed';

  // Real data wins wherever it exists; the fallback only catches a finished
  // job that never had a total to divide by.
  const width = percent ?? (done ? 100 : null);

  if (job.status === 'queued' && job.processedRows === 0) {
    return <span className="text-[13px] text-ink-subtle">Waiting for a worker</span>;
  }

  return (
    <div className="w-full">
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-line">
        {width === null ? (
          <div
            className={`h-full w-1/3 rounded-full ${running ? 'animate-pulse bg-accent' : 'bg-mute'}`}
          />
        ) : (
          <div
            className={`h-full rounded-full transition-[width] duration-500 ${
              job.status === 'failed' ? 'bg-bad' : done ? 'bg-good' : 'bg-accent'
            }`}
            style={{ width: `${width}%` }}
          />
        )}
      </div>

      {showLabel && (
        <p className="mt-1.5 text-[13px] tabular-nums text-ink-subtle">
          {percent !== null
            ? `${formatCount(job.processedRows)} / ${formatCount(job.totalRows)} rows · ${percent}%`
            : done
              ? // No total to divide by, but the count itself is final — say
                // the number and stop, rather than reporting a missing total
                // the user cannot do anything about.
                `${formatCount(job.processedRows)} rows processed`
              : `${formatCount(job.processedRows)} rows processed — total not counted yet`}
        </p>
      )}
    </div>
  );
}

export function DownloadLink({ job }: { job: JobRecord }) {
  if (!job.downloadable) {
    return <span className="text-[13px] text-ink-subtle">—</span>;
  }

  return (
    <Link
      href={`/api/jobs/${job.id}/download`}
      prefetch={false}
      className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[13px] font-medium text-accent transition-colors hover:bg-accent-soft"
    >
      <Download className="h-3.5 w-3.5" />
      CSV
    </Link>
  );
}
