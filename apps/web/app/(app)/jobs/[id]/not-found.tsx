import Link from 'next/link';
import { Clock } from '@/components/icons';
import { buttonClass, Card } from '@/components/ui';

export default function JobNotFound() {
  return (
    <Card className="mx-auto max-w-lg">
      <div className="px-6 py-12 text-center">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-xl border border-line bg-surface-sunken text-ink-subtle">
          <Clock className="h-5 w-5" />
        </span>

        <h1 className="mt-5 text-base font-semibold tracking-tight text-ink">No such job</h1>
        <p className="mx-auto mt-2 max-w-sm text-[13px] leading-relaxed text-ink-muted">
          The job either never existed, or its retention window has passed and it was deleted along
          with the addresses it held.
        </p>

        <div className="mt-6 flex flex-wrap justify-center gap-2.5">
          <Link href="/jobs" className={buttonClass()}>
            Back to jobs
          </Link>
          <Link href="/" className={buttonClass({ variant: 'secondary' })}>
            Verify a new list
          </Link>
        </div>
      </div>
    </Card>
  );
}
