import { redirect } from 'next/navigation';
import { AuthForm } from '@/components/auth-form';
import { currentUser } from '@/lib/session';
import { Card } from '@/components/ui';
import { safeNext } from '@/lib/next-path';

export const metadata = { title: 'Sign in' };
export const dynamic = 'force-dynamic';

interface Props {
  searchParams: Promise<{ next?: string | string[] }>;
}

export default async function LoginPage({ searchParams }: Props) {
  const { next } = await searchParams;
  const target = safeNext(next);

  // Someone already signed in has nothing to do here, and showing them a login
  // form invites them to think their session ended.
  if ((await currentUser()) !== null) redirect(target);

  return (
    <Card className="p-6 shadow-raised sm:p-7">
      <h1 className="text-xl font-semibold tracking-tight text-ink">Sign in</h1>
      <p className="mb-6 mt-1.5 text-[13px] leading-relaxed text-ink-muted">
        Your jobs, keys and credit balance are on the other side of this form.
      </p>

      <AuthForm mode="login" next={target} />
    </Card>
  );
}
