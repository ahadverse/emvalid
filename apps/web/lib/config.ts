import 'server-only';

/**
 * Every environment knob in one place, read once at module load so a typo in
 * the environment fails at boot rather than on the first 600 MB upload.
 */

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;

  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive number, got ${JSON.stringify(raw)}`);
  }
  return Math.floor(value);
}

/*
 * Where uploads and results live is no longer configured here. This app runs
 * on Vercel and the worker on Render, so there is no directory both can see —
 * both go through @ev/storage instead, which reads its own environment
 * (`S3_BUCKET` and friends, or `DATA_DIR` for the local driver). See DEPLOY.md.
 */

/**
 * Hard ceiling on an upload. Enforced while streaming, not from
 * Content-Length, because a client controls that header and we do not.
 */
export const MAX_UPLOAD_BYTES = intEnv('MAX_UPLOAD_BYTES', 1024 * 1024 * 1024);

/**
 * Feature 24 — job files and rows are deleted this long after creation.
 * Passed to @ev/db's enqueue, which stamps `expiresAt` from it.
 */
export const RETENTION_DAYS = intEnv('DATA_RETENTION_DAYS', 7);

/** Per-key request budget for the public API. See lib/rate-limit.ts. */
export const API_RATE_LIMIT = intEnv('API_RATE_LIMIT', 60);
export const API_RATE_WINDOW_MS = intEnv('API_RATE_WINDOW_MS', 60_000);

/** The dashboard is unauthenticated in v1, so it gets a tighter, IP-keyed budget. */
export const UI_RATE_LIMIT = intEnv('UI_RATE_LIMIT', 20);
export const UI_RATE_WINDOW_MS = intEnv('UI_RATE_WINDOW_MS', 60_000);

/**
 * DNS resolvers for the verification engine. Empty means the system resolver,
 * which is fine for single checks but will get rate-limited under bulk — the
 * VPS points this at a local unbound instance (feature 23).
 */
export const DNS_SERVERS = (process.env.DNS_SERVERS ?? '')
  .split(',')
  .map((server) => server.trim())
  .filter((server) => server.length > 0);

/**
 * The v1 single-tenant owner.
 *
 * No longer used to attribute anything — v2 gave every job and key a real
 * signed-in owner. It survives as the id the 0002 migration seeded and the
 * 0003 migration promoted to admin, which is what any pre-accounts data still
 * points at. Deleting the constant would not delete that row.
 */
export const LEGACY_OWNER_USER_ID =
  process.env.EV_USER_ID ?? '00000000-0000-0000-0000-000000000001';

/**
 * Feature 26 — credits granted to a new account so the product can be tried
 * before it is bought.
 *
 * A trial grant, not a free plan: it is granted once, at signup, and never
 * refills. Set `SIGNUP_CREDITS=0` to close that door entirely and require a
 * paid order before anything can be verified.
 */
export const SIGNUP_CREDITS = (() => {
  const raw = process.env.SIGNUP_CREDITS;
  if (raw === undefined || raw.trim() === '') return 25;

  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`SIGNUP_CREDITS must be zero or a positive number, got ${JSON.stringify(raw)}`);
  }
  return Math.floor(value);
})();

/**
 * How many credits an account must hold before it may start a bulk job.
 *
 * A file's real row count is unknown until the worker has read it, so the gate
 * at upload time can only be "has this account got anything at all". The exact
 * charge happens per chunk, in the worker, against the same balance.
 */
export const MIN_CREDITS_TO_UPLOAD = intEnv('MIN_CREDITS_TO_UPLOAD', 1);

/**
 * Where a customer actually sends the money.
 *
 * There is no payment gateway (PLAN.md keeps it pending on a merchant
 * account), so settlement is out of band: the customer places an order, pays
 * by bKash or bank transfer, and quotes the order id. Set `PAYMENT_ACCOUNT` to
 * the number or account to pay, and `PAYMENT_CONTACT` to whoever confirms it.
 *
 * Both default to null rather than to an invented number. A billing page that
 * displays a plausible-looking bKash number nobody owns is worse than one that
 * admits it is not configured — the first sends money to a stranger.
 */
export const PAYMENT_ACCOUNT = process.env.PAYMENT_ACCOUNT?.trim() || null;
export const PAYMENT_CONTACT = process.env.PAYMENT_CONTACT?.trim() || null;

/**
 * Hybrid SMTP fallback (feature 45's "Deep Scan", pending in PLAN.md) via
 * Verifalia's API — real mailbox verification, borrowed rather than
 * self-hosted. Both default to null rather than a fake pair: `lib/verifalia.ts`
 * treats null as "not configured" and skips the call entirely, the same way
 * an unset `PAYMENT_ACCOUNT` skips showing a bKash number nobody owns. Never
 * automatic on a plain single check — see `lib/verifalia.ts` for why.
 */
export const VERIFALIA_USERNAME = process.env.VERIFALIA_USERNAME?.trim() || null;
export const VERIFALIA_PASSWORD = process.env.VERIFALIA_PASSWORD?.trim() || null;

