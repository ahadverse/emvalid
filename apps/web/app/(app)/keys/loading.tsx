import { Card, Skeleton } from '@/components/ui';

export default function KeysLoading() {
  return (
    <div>
      <div className="mb-8">
        <Skeleton className="h-6 w-24 rounded-full" />
        <Skeleton className="mt-4 h-8 w-48" />
        <Skeleton className="mt-3 h-4 w-full max-w-2xl" />
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <div className="space-y-6 lg:col-span-3">
          <Card>
            <div className="border-b border-line px-5 py-4">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="mt-2 h-3 w-72" />
            </div>
            <div className="flex gap-2.5 px-5 py-4">
              <Skeleton className="h-9.5 flex-1 rounded-lg" />
              <Skeleton className="h-9.5 w-28 rounded-lg" />
            </div>
          </Card>

          <Card>
            <div className="border-b border-line px-5 py-4">
              <Skeleton className="h-4 w-16" />
            </div>
            <div className="divide-y divide-line">
              {[0, 1, 2].map((index) => (
                <div key={index} className="flex items-center gap-6 px-5 py-4">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="hidden h-4 w-32 sm:block" />
                </div>
              ))}
            </div>
          </Card>
        </div>

        <div className="lg:col-span-2">
          <Card className="h-full">
            <div className="border-b border-line px-5 py-4">
              <Skeleton className="h-4 w-36" />
            </div>
            <div className="space-y-5 px-5 py-5">
              {[0, 1, 2, 3].map((index) => (
                <div key={index}>
                  <Skeleton className="h-3.5 w-32" />
                  <Skeleton className="mt-2 h-3 w-full" />
                  <Skeleton className="mt-1.5 h-3 w-4/5" />
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
