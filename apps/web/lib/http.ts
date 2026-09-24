import 'server-only';

import { NextResponse } from 'next/server';
import type { User } from '@ev/db';
import { authenticate, type ApiKeyIdentity } from './auth';
import {
  API_RATE_LIMIT,
  API_RATE_WINDOW_MS,
  UI_RATE_LIMIT,
  UI_RATE_WINDOW_MS,
} from './config';
import { clientIp, rateLimit, rateLimitHeaders } from './rate-limit';
import { currentUser } from './session';

/**
 * One error envelope for every route, so a client can branch on `error.code`
 * instead of matching on prose we might reword.
 */
export interface ApiError {
  error: {
    code: string;
    message: string;
  };
}

export function jsonError(
  code: string,
  message: string,
  status: number,
  headers: Record<string, string> = {},
): NextResponse<ApiError> {
  return NextResponse.json<ApiError>({ error: { code, message } }, { status, headers });
}

export function json<T>(
  body: T,
  status = 200,
  headers: Record<string, string> = {},
): NextResponse<T> {
  return NextResponse.json(body, { status, headers });
}

/** Bodies are user input; a parse failure is a 400, never a 500. */
export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new HttpError('invalid_json', 'Request body is not valid JSON.', 400);
  }
}

export class HttpError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

/**
 * Wraps a handler so an unexpected throw becomes a 500 with no internals in
 * the body. The stack goes to the server log; the caller gets a code.
 */
export function withErrors<Args extends unknown[]>(
  handler: (request: Request, ...args: Args) => Promise<Response>,
): (request: Request, ...args: Args) => Promise<Response> {
  return async (request, ...args) => {
    try {
      return await handler(request, ...args);
    } catch (error) {
      if (error instanceof HttpError) return jsonError(error.code, error.message, error.status);
      console.error('unhandled route error', error);
      return jsonError('internal_error', 'Something went wrong on our side.', 500);
    }
  };
}

export type GuardResult =
  | { ok: true; identity: ApiKeyIdentity; headers: Record<string, string> }
  | { ok: false; response: Response };

/**
 * Feature 20 + rate limiting for every /api/v1 route: authenticate first, then
 * spend budget. Doing it the other way round would let an unauthenticated
 * flood exhaust a real key's allowance.
 */
export async function guardApi(request: Request): Promise<GuardResult> {
  const auth = await authenticate(request);

  if (!auth.ok) {
    // Always 401, never 403: a 403 would mean "we know who you are, you may
    // not do this", and a key we could not resolve tells us neither.
    return {
      ok: false,
      response: jsonError(auth.reason, auth.message, 401, {
        'WWW-Authenticate': 'Bearer realm="api"',
      }),
    };
  }

  const limit = rateLimit(`key:${auth.identity.keyId}`, API_RATE_LIMIT, API_RATE_WINDOW_MS);
  const headers = rateLimitHeaders(limit);

  if (!limit.allowed) {
    return {
      ok: false,
      response: jsonError(
        'rate_limited',
        `Rate limit exceeded: ${limit.limit} requests per ${Math.round(API_RATE_WINDOW_MS / 1000)}s.`,
        429,
        headers,
      ),
    };
  }

  return { ok: true, identity: auth.identity, headers };
}

export type UiGuardResult =
  | { ok: true; user: User; headers: Record<string, string> }
  | { ok: false; response: Response };

/**
 * The dashboard's equivalent of `guardApi`: session cookie instead of bearer
 * key, then the tighter IP-keyed budget.
 *
 * Every /api route the browser calls on a signed-in user's behalf goes through
 * this. Before it existed these routes were open — anyone who knew the URL
 * could list jobs, download a finished result file, or mint an API key — which
 * is survivable on localhost and not survivable anywhere else.
 *
 * 401 with no `WWW-Authenticate`, unlike the API guard: there is no credential
 * a browser could usefully be prompted for here. The client's move is to send
 * the user to /login, and `error.code` is what tells it to.
 */
export async function guardUi(request: Request): Promise<UiGuardResult> {
  const user = await currentUser();

  if (user === null) {
    return {
      ok: false,
      response: jsonError('unauthenticated', 'Sign in to continue.', 401),
    };
  }

  // Keyed on the account once we have one — an IP is shared by everyone behind
  // a NAT, and metering an office of ten people as one client is how a real
  // user gets rate limited by a colleague.
  const limit = rateLimit(`ui:${user.id}`, UI_RATE_LIMIT, UI_RATE_WINDOW_MS);
  const headers = rateLimitHeaders(limit);

  if (!limit.allowed) {
    return {
      ok: false,
      response: jsonError(
        'rate_limited',
        `Too many requests. Try again in ${limit.retryAfter}s.`,
        429,
        headers,
      ),
    };
  }

  return { ok: true, user, headers };
}

/**
 * `guardUi`, and then the role check.
 *
 * 404 rather than 403 for a signed-in non-admin: a customer probing
 * /api/admin/* learns nothing about whether those routes exist. A logged-out
 * caller still gets the 401 `guardUi` produced, because "sign in" is not a
 * secret and pretending otherwise only breaks the client's redirect.
 */
export async function guardAdmin(request: Request): Promise<UiGuardResult> {
  const guard = await guardUi(request);
  if (!guard.ok) return guard;

  if (guard.user.role !== 'admin') {
    return { ok: false, response: jsonError('not_found', 'Not found.', 404, guard.headers) };
  }

  return guard;
}

/**
 * Rate limiting for the routes that have no caller identity at all — the
 * single-address check on the public landing page.
 *
 * The IP is all there is, which is weak, which is why this budget is the
 * smallest one in the app.
 */
export function guardAnonymous(request: Request):
  | { ok: true; headers: Record<string, string> }
  | { ok: false; response: Response } {
  const limit = rateLimit(`anon:${clientIp(request)}`, UI_RATE_LIMIT, UI_RATE_WINDOW_MS);
  const headers = rateLimitHeaders(limit);

  if (!limit.allowed) {
    return {
      ok: false,
      response: jsonError(
        'rate_limited',
        `Too many checks. Try again in ${limit.retryAfter}s.`,
        429,
        headers,
      ),
    };
  }

  return { ok: true, headers };
}
