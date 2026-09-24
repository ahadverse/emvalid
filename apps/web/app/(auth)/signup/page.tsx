import { redirect } from 'next/navigation';
import { AuthForm } from '@/components/auth-form';
import { SIGNUP_CREDITS } from '@/lib/config';
import { safeNext } from '@/lib/next-path';
import { currentUser } from '@/lib/session';
import { formatCount } from '@/lib/format';
import { Card, Notice } from '@/components/ui';

export const metadata = { title: 'Create an account' };
export const dynamic = 'force-dynamic';

interface Props {
  searchParams: Promise<{ next?: string | string[] }>;
}

export default async function SignupPage({ searchParams }: Props) {
  const { next } = await searchParams;
  const target = safeNext(next);

  if ((await currentUser()) !== null) redirect(target);

  return (
    <Card className="p-6 shadow-raised sm:p-7">
      <h1 className="text-xl font-semibold tracking-tight text-ink">Create an account</h1>
      <p className="mb-6 mt-1.5 text-[13px] leading-relaxed text-ink-muted">
        You need one to upload a list, because a job has to belong to somebody.
      </p>

      {SIGNUP_CREDITS > 0 && (
        <div className="mb-5">
          {/*
            Stated as what it is — a one-off grant — because "free credits" on
            a signup form is read as a free tier, and there isn't one.
          */}
          <Notice tone="accent">
            New accounts get {formatCount(SIGNUP_CREDITS)} verification credits to try the
            product. They are granted once and do not refill.
          </Notice>
        </div>
      )}

      <AuthForm mode="signup" next={target} />
    </Card>
  );
}
