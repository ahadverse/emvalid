/**
 * Sanitises the `?next=` parameter the login page redirects to.
 *
 * This is an open-redirect guard, and it is the reason the parameter is not
 * simply passed through. `?next=https://evil.example/login` on a link that
 * genuinely comes from our domain is the oldest phishing setup there is: the
 * victim checks the hostname, signs in, and is handed to a copy of the page
 * that asks them to sign in again.
 *
 * Only a path on this origin survives. Everything else falls back to /jobs.
 */

export const DEFAULT_NEXT = '/jobs';

/**
 * Control characters and DEL, checked by code point rather than by a regex
 * literal — a range of raw control characters typed into source is invisible
 * in every editor and survives exactly one careless copy-paste.
 *
 * A newline reaching a `Location` header is response splitting.
 */
function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

export function safeNext(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === undefined || raw.length === 0) return DEFAULT_NEXT;

  /*
   * `//evil.example` is the case a naive `startsWith('/')` misses — a
   * protocol-relative URL is absolute, and browsers treat it as one. `/\` is
   * the same attack again: several browsers normalise the backslash to a
   * forward slash *after* a check like this has already approved it.
   */
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) {
    return DEFAULT_NEXT;
  }

  if (hasControlCharacter(raw)) return DEFAULT_NEXT;

  // The auth pages themselves are never a destination — landing back on the
  // login form after signing in reads as a failed sign-in.
  const path = raw.split('?')[0];
  if (path === '/login' || path === '/signup') return DEFAULT_NEXT;

  return raw;
}
