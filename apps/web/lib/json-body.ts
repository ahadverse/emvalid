import 'server-only';

/**
 * Reading fields off a JSON request body without trusting any of it.
 *
 * The upload routes all take small JSON objects from a client, and each one
 * would otherwise grow its own `typeof x === 'string'` ladder. One ladder,
 * used four times, is harder to get subtly wrong in the fourth place.
 */

export async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  const parsed: unknown = await request.json().catch(() => null);
  // Arrays and `null` both typeof as 'object'; neither is a body we accept.
  return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {};
}

/** Null for absent, empty or non-string — callers turn that into one 400. */
export function stringField(body: Record<string, unknown>, field: string): string | null {
  const value = body[field];
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

/** Undefined for anything that is not a non-negative finite number. */
export function numberField(body: Record<string, unknown>, field: string): number | undefined {
  const value = body[field];
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}
