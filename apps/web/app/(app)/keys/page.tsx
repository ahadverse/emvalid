import { listApiKeys } from '@/lib/api-keys';
import { API_RATE_LIMIT, API_RATE_WINDOW_MS } from '@/lib/config';
import { requireUser } from '@/lib/session';
import { KeysManager } from '@/components/keys-manager';
import { CodeTabs, type CodeSample } from '@/components/code-tabs';
import { Key, Shield } from '@/components/icons';
import { Card, CardHeader, Chip, Eyebrow, PageHeader, SectionLabel } from '@/components/ui';

/**
 * Feature 20 — API key management, and the reference that makes a key worth
 * creating.
 *
 * The list is fetched server-side so the page arrives complete; only creation,
 * revocation and the language tabs need the client, and only creation ever
 * handles a raw key.
 */

export const metadata = { title: 'API keys' };
export const dynamic = 'force-dynamic';

const VERIFY_SAMPLES: readonly CodeSample[] = [
  {
    id: 'curl',
    label: 'curl',
    code: `curl -X POST https://your-host/api/v1/verify \\
  -H "Authorization: Bearer $EV_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"email":"name@example.com"}'`,
  },
  {
    id: 'js',
    label: 'JavaScript',
    code: `const response = await fetch("https://your-host/api/v1/verify", {
  method: "POST",
  headers: {
    Authorization: \`Bearer \${process.env.EV_API_KEY}\`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ email: "name@example.com" }),
});

const result = await response.json();
console.log(result.advice, result.confidence, result.reason);`,
  },
  {
    id: 'python',
    label: 'Python',
    code: `import os, requests

response = requests.post(
    "https://your-host/api/v1/verify",
    headers={"Authorization": f"Bearer {os.environ['EV_API_KEY']}"},
    json={"email": "name@example.com"},
    timeout=30,
)

result = response.json()
print(result["advice"], result["confidence"], result["reason"])`,
  },
];

const JOB_SAMPLES: readonly CodeSample[] = [
  {
    id: 'curl',
    label: 'curl',
    code: `# Submit — returns 201 with the job record
curl -X POST https://your-host/api/v1/jobs \\
  -H "Authorization: Bearer $EV_API_KEY" \\
  -F "file=@list.csv"

# Poll until status is completed, failed or cancelled
curl https://your-host/api/v1/jobs/<id> \\
  -H "Authorization: Bearer $EV_API_KEY"`,
  },
  {
    id: 'js',
    label: 'JavaScript',
    code: `const form = new FormData();
form.append("file", file, "list.csv");

const auth = { Authorization: \`Bearer \${process.env.EV_API_KEY}\` };
const created = await fetch("https://your-host/api/v1/jobs", {
  method: "POST",
  headers: auth,
  body: form,
}).then((r) => r.json());

// The job runs on a worker; poll rather than hold the connection open.
let job = created;
while (!["completed", "failed", "cancelled"].includes(job.status)) {
  await new Promise((resolve) => setTimeout(resolve, 2000));
  job = await fetch(\`https://your-host/api/v1/jobs/\${created.id}\`, {
    headers: auth,
  }).then((r) => r.json());
}

console.log(job.summary);`,
  },
  {
    id: 'python',
    label: 'Python',
    code: `import os, time, requests

auth = {"Authorization": f"Bearer {os.environ['EV_API_KEY']}"}

with open("list.csv", "rb") as handle:
    job = requests.post(
        "https://your-host/api/v1/jobs",
        headers=auth,
        files={"file": handle},
        timeout=600,
    ).json()

while job["status"] not in ("completed", "failed", "cancelled"):
    time.sleep(2)
    job = requests.get(
        f"https://your-host/api/v1/jobs/{job['id']}",
        headers=auth,
        timeout=30,
    ).json()

print(job["summary"])`,
  },
];

const ENDPOINTS = [
  {
    method: 'POST',
    path: '/api/v1/verify',
    summary: 'Verify one address. Returns the engine result model verbatim.',
  },
  {
    method: 'POST',
    path: '/api/v1/jobs',
    summary: 'Submit a CSV or XLSX as multipart/form-data. Returns 201 and the job record.',
  },
  {
    method: 'GET',
    path: '/api/v1/jobs',
    summary: 'List jobs, newest first. `?limit=` up to 100.',
  },
  {
    method: 'GET',
    path: '/api/v1/jobs/:id',
    summary: 'One job, including the full breakdown once it has completed.',
  },
] as const;

const METHOD_CHIPS: Record<string, string> = {
  GET: 'bg-good-soft text-good ring-1 ring-good/25',
  POST: 'bg-accent-soft text-accent ring-1 ring-accent/25',
};

export default async function KeysPage() {
  const user = await requireUser('/keys');
  const keys = await listApiKeys(user.id);
  const windowSeconds = Math.round(API_RATE_WINDOW_MS / 1000);

  return (
    <div className="space-y-12">
      <div>
        <PageHeader
          eyebrow={<Eyebrow icon={Key}>Developers</Eyebrow>}
          title="API keys"
          description="Keys authenticate requests to /api/v1. Only a SHA-256 hash is stored, so a key is readable exactly once — at the moment it is created."
        />

        <div className="grid gap-6 lg:grid-cols-5">
          <div className="lg:col-span-3">
            <KeysManager initialKeys={keys} />
          </div>

          <div className="lg:col-span-2">
            <Card className="h-full">
              <CardHeader title="How keys behave" icon={Shield} />
              <dl className="divide-y divide-line text-[13px] leading-relaxed">
                <div className="px-5 py-3.5">
                  <dt className="font-medium text-ink">Shown once</dt>
                  <dd className="mt-1 text-ink-muted">
                    We store a SHA-256 hash, never the key. Nobody — including us — can read it
                    back. Lose it and the fix is to revoke and create another.
                  </dd>
                </div>
                <div className="px-5 py-3.5">
                  <dt className="font-medium text-ink">Revocation is immediate</dt>
                  <dd className="mt-1 text-ink-muted">
                    The next request with a revoked key gets a 401. There is no grace period, so
                    name each key after the thing that uses it.
                  </dd>
                </div>
                <div className="px-5 py-3.5">
                  <dt className="font-medium text-ink">Rate limit</dt>
                  <dd className="mt-1 text-ink-muted">
                    {API_RATE_LIMIT} requests per {windowSeconds}s per key, reported in the{' '}
                    <code className="font-mono text-ink">RateLimit-*</code> response headers. It is
                    enforced per server process, so treat it as a floor rather than a contract.
                  </dd>
                </div>
                <div className="px-5 py-3.5">
                  <dt className="font-medium text-ink">Transport</dt>
                  <dd className="mt-1 text-ink-muted">
                    Send the key as{' '}
                    <code className="font-mono text-ink">Authorization: Bearer &lt;key&gt;</code>.
                    Never in a query string — those end up in access logs and browser history.
                  </dd>
                </div>
              </dl>
            </Card>
          </div>
        </div>
      </div>

      {/* -------------------------------------------------- Reference */}
      <div id="reference" className="scroll-mt-20">
        <SectionLabel>API reference</SectionLabel>

        <div className="space-y-6">
          <Card>
            <CardHeader
              title="Endpoints"
              description="Four of them. Everything the dashboard does, your code can do."
            />
            <ul className="divide-y divide-line">
              {ENDPOINTS.map((endpoint) => (
                <li
                  key={endpoint.method + endpoint.path}
                  className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-5 py-3 transition-colors hover:bg-surface-sunken"
                >
                  <Chip className={`${METHOD_CHIPS[endpoint.method]} font-mono`}>
                    {endpoint.method}
                  </Chip>
                  <code className="font-mono text-[13px] font-medium text-ink">
                    {endpoint.path}
                  </code>
                  <span className="w-full text-[13px] text-ink-muted sm:w-auto sm:flex-1">
                    {endpoint.summary}
                  </span>
                </li>
              ))}
            </ul>
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader
                title="Verify one address"
                description="Synchronous. Answers in the time one DNS lookup takes."
              />
              <div className="px-5 py-5">
                <CodeTabs samples={VERIFY_SAMPLES} />
                <p className="mt-4 text-[13px] leading-relaxed text-ink-muted">
                  The response is the engine&rsquo;s own result model:{' '}
                  <code className="font-mono text-ink">status</code>,{' '}
                  <code className="font-mono text-ink">advice</code>,{' '}
                  <code className="font-mono text-ink">confidence</code>,{' '}
                  <code className="font-mono text-ink">reason</code>,{' '}
                  <code className="font-mono text-ink">detail</code>,{' '}
                  <code className="font-mono text-ink">suggestion</code> and{' '}
                  <code className="font-mono text-ink">flags</code>. Nothing is flattened into
                  valid/invalid.
                </p>
              </div>
            </Card>

            <Card>
              <CardHeader
                title="Submit a list"
                description="Asynchronous. Upload, then poll for the breakdown."
              />
              <div className="px-5 py-5">
                <CodeTabs samples={JOB_SAMPLES} />
                <p className="mt-4 text-[13px] leading-relaxed text-ink-muted">
                  A job is terminal once <code className="font-mono text-ink">status</code> reads{' '}
                  <code className="font-mono text-ink">completed</code>,{' '}
                  <code className="font-mono text-ink">failed</code> or{' '}
                  <code className="font-mono text-ink">cancelled</code>; only then does{' '}
                  <code className="font-mono text-ink">summary</code> appear. Result files are
                  deleted when the retention window passes, so download rather than re-fetch later.
                </p>
              </div>
            </Card>
          </div>

          <Card>
            <CardHeader
              title="Errors"
              description="Every failure has the same shape, so one handler covers all of them."
            />
            <div className="px-5 py-5">
              <CodeTabs
                samples={[
                  {
                    id: 'shape',
                    label: 'Response body',
                    code: `{
  "error": {
    "code": "invalid_request",
    "message": "email must be a non-empty string."
  }
}`,
                  },
                ]}
              />
              <dl className="mt-4 grid gap-x-6 gap-y-2 text-[13px] sm:grid-cols-2">
                {[
                  ['400', 'The request body was not what the endpoint expects.'],
                  ['401', 'Missing, malformed, revoked or unknown key.'],
                  ['404', 'No such job — or it belongs to another key.'],
                  ['413', 'The upload exceeded the configured size ceiling.'],
                  ['429', 'Rate limited. Back off until the RateLimit-Reset header.'],
                  ['500', 'Our fault. The response carries no detail; the server log does.'],
                ].map(([code, meaning]) => (
                  <div key={code} className="flex gap-3">
                    <dt className="w-9 shrink-0 font-mono font-medium text-ink">{code}</dt>
                    <dd className="text-ink-muted">{meaning}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
