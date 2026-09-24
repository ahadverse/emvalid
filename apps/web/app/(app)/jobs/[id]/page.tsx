import { cache } from 'react';
import { notFound } from 'next/navigation';
import { getJob } from '@/lib/jobs';
import { requireUser } from '@/lib/session';
import { JobLive } from '@/components/job-live';

/**
 * The first render is server-side with real data, so the page is complete
 * before any JavaScript runs and a finished job never flashes a loading state.
 * `JobLive` takes over only if there is something left to watch.
 *
 * No breadcrumb here: the shell's top bar derives one from the URL on every
 * page in app/(app), and the filename is the `<h1>` inside `JobLive`.
 */

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ id: string }>;
}

/**
 * `generateMetadata` and the page both need the job. React's request-scoped
 * cache collapses that into one query instead of two per page load.
 *
 * Keyed on the owner as well as the id: two accounts asking for the same id in
 * the same request would otherwise share one cached answer, which is a
 * cross-tenant leak hiding inside a performance optimisation.
 */
const loadJob = cache((userId: string, id: string) => getJob(userId, id));

export async function generateMetadata({ params }: Props) {
  const { id } = await params;
  const user = await requireUser(`/jobs/${id}`);
  const job = await loadJob(user.id, id);
  return { title: job?.originalFilename ?? 'Job' };
}

export default async function JobPage({ params }: Props) {
  const { id } = await params;
  const user = await requireUser(`/jobs/${id}`);

  // `getJob` matches owner and id together, so another account's job is a 404
  // here rather than a 403 — an id must not be probeable for existence.
  const job = await loadJob(user.id, id);
  if (job === null) notFound();

  return <JobLive initial={job} />;
}
