import 'server-only';

/**
 * Sliding-window rate limiter, in memory.
 *
 * IMPORTANT — this counts requests *per process*. Two Node instances behind a
 * load balancer each allow the full budget, and a restart clears every window.
 * It is here to stop one client hammering one box, not to enforce a quota.
 * Real quota enforcement (feature 27) needs shared state — Redis or a Postgres
 * counter — and is a v2 concern; putting a fake distributed limiter here would
 * be worse than an honest local one.
 */

export interface RateLimitResult {
  allowed: boolean;
  /** Requests still available in the current window. */
  remaining: number;
  limit: number;
  /** Unix ms when the oldest counted request falls out of the window. */
  resetAt: number;
  /** Seconds a rejected caller should wait. Zero when allowed. */
  retryAfter: number;
}

/** Timestamps of the requests still inside the window, oldest first. */
const windows = new Map<string, number[]>();

/**
 * A key that never comes back leaks its array forever. Sweeping on a counter
 * rather than a timer keeps this free in the common case and avoids holding
 * the event loop open in a serverless process.
 */
let callsSinceSweep = 0;
const SWEEP_EVERY = 500;

function sweep(now: number, windowMs: number): void {
  for (const [key, hits] of windows) {
    if (hits.length === 0 || now - hits[hits.length - 1]! > windowMs) {
      windows.delete(key);
    }
  }
}

export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();

  if (++callsSinceSweep >= SWEEP_EVERY) {
    callsSinceSweep = 0;
    sweep(now, windowMs);
  }

  const cutoff = now - windowMs;
  const hits = windows.get(key) ?? [];

  // Timestamps are pushed in order, so everything expired is a prefix.
  let expired = 0;
  while (expired < hits.length && hits[expired]! <= cutoff) expired++;
  const live = expired === 0 ? hits : hits.slice(expired);

  if (live.length >= limit) {
    const oldest = live[0]!;
    const resetAt = oldest + windowMs;
    windows.set(key, live);
    return {
      allowed: false,
      remaining: 0,
      limit,
      resetAt,
      retryAfter: Math.max(1, Math.ceil((resetAt - now) / 1000)),
    };
  }

  live.push(now);
  windows.set(key, live);

  return {
    allowed: true,
    remaining: limit - live.length,
    limit,
    resetAt: live[0]! + windowMs,
    retryAfter: 0,
  };
}

/** Standard headers so a client can back off without parsing our error body. */
export function rateLimitHeaders(result: RateLimitResult): Record<string, string> {
  const headers: Record<string, string> = {
    'RateLimit-Limit': String(result.limit),
    'RateLimit-Remaining': String(result.remaining),
    'RateLimit-Reset': String(Math.max(0, Math.ceil((result.resetAt - Date.now()) / 1000))),
  };
  if (!result.allowed) headers['Retry-After'] = String(result.retryAfter);
  return headers;
}

/**
 * Best-effort client identity for the unauthenticated dashboard routes. Behind
 * a proxy this is only as trustworthy as the proxy — which is why it is not
 * used for anything the public API depends on.
 */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  const first = forwarded?.split(',')[0]?.trim();
  return first && first.length > 0 ? first : (request.headers.get('x-real-ip') ?? 'unknown');
}
