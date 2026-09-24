import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';

/**
 * Feature 25 — password hashing.
 *
 * scrypt from node:crypto, not bcrypt or argon2. Both of those are native
 * addons: they need a compiler on the deploy box, they break on a Node major
 * upgrade, and they are the single most common reason a small Node service
 * will not build. scrypt is in the standard library, is memory-hard, and is
 * what the OWASP password storage guidance names as an acceptable choice.
 *
 * The opposite reasoning from api-keys.ts, and deliberately so. An API key is
 * 256 random bits and is checked on every request, so it gets a fast SHA-256.
 * A password is chosen by a human, is guessable, and is checked once per login
 * — so it gets something expensive on purpose.
 *
 * Stored format, one line, self-describing:
 *
 *     scrypt$N$r$p$<salt base64url>$<hash base64url>
 *
 * The parameters travel with the hash so raising the cost later does not
 * invalidate every existing password: an old hash still verifies against its
 * own recorded N, and `needsRehash` reports that it should be upgraded on the
 * user's next successful login.
 */

/**
 * Hand-wrapped rather than `promisify(scrypt)`.
 *
 * `promisify` resolves to the *first* overload in the type definitions, which
 * is the three-argument one — so passing the options object that carries N, r
 * and p is a type error, and the only ways past it are a cast or dropping the
 * cost parameters entirely. Both are worse than eight lines.
 */
function scryptAsync(
  password: string,
  salt: Buffer,
  keyLength: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keyLength, options, (error, derived) => {
      if (error !== null) reject(error);
      else resolve(derived);
    });
  });
}

/**
 * ~64 MB and roughly 100 ms on a small VPS. `maxmem` has to be raised to match
 * — Node's default ceiling is 32 MB and would reject this outright.
 */
const COST = { N: 2 ** 16, r: 8, p: 1 } as const;
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;

function maxmem(N: number, r: number): number {
  // Node's own formula, with headroom: 128 * N * r is the working set.
  return 256 * N * r;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);

  const derived = await scryptAsync(password.normalize('NFKC'), salt, KEY_LENGTH, {
    N: COST.N,
    r: COST.r,
    p: COST.p,
    maxmem: maxmem(COST.N, COST.r),
  });

  return [
    'scrypt',
    COST.N,
    COST.r,
    COST.p,
    salt.toString('base64url'),
    derived.toString('base64url'),
  ].join('$');
}

/**
 * Never throws on a malformed or absent hash — it returns false.
 *
 * Accounts that pre-date logins have a null hash (see the v1 seed owner), and
 * a login attempt against one of those is a normal wrong-password, not a
 * server error.
 */
export async function verifyPassword(
  password: string,
  stored: string | null | undefined,
): Promise<boolean> {
  if (stored === null || stored === undefined || stored.length === 0) return false;

  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  const salt = parts[4];
  const expected = parts[5];

  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
  if (salt === undefined || expected === undefined) return false;
  // A hostile row could otherwise name a cost that hangs the process.
  if (N < 2 ** 12 || N > 2 ** 20 || r < 1 || r > 32 || p < 1 || p > 16) return false;

  const expectedBuffer = Buffer.from(expected, 'base64url');
  if (expectedBuffer.length === 0) return false;

  let derived: Buffer;
  try {
    derived = await scryptAsync(
      password.normalize('NFKC'),
      Buffer.from(salt, 'base64url'),
      expectedBuffer.length,
      { N, r, p, maxmem: maxmem(N, r) },
    );
  } catch {
    return false;
  }

  if (derived.length !== expectedBuffer.length) return false;
  return timingSafeEqual(derived, expectedBuffer);
}

/** True when a stored hash used weaker parameters than we now use. */
export function needsRehash(stored: string | null | undefined): boolean {
  if (stored === null || stored === undefined) return false;

  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return true;

  return Number(parts[1]) < COST.N || Number(parts[2]) < COST.r;
}

/*
 * Password *policy* — length, common-password rejection — lives in
 * lib/account-input.ts, not here. The signup form runs the same checks in the
 * browser, and this module cannot go there: it imports node:crypto and is
 * marked server-only.
 */
