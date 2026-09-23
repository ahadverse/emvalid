import { createHash, randomBytes } from 'node:crypto';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { getDb, type Database } from './client.ts';
import { apiKeys, type ApiKey } from './schema.ts';

/**
 * Feature 20 — API key authentication.
 *
 * The raw key exists in exactly two places: the response that created it, and
 * the user's clipboard. We keep its SHA-256 and never the key itself, so this
 * table is worthless to anyone who steals it.
 *
 * SHA-256 and not bcrypt/argon2 on purpose. Those are for passwords, which
 * humans choose badly and which therefore must be slow to guess. An API key is
 * 256 bits of `randomBytes` — unguessable by construction — and it is checked
 * on every single API call, so a deliberately slow hash would only be a
 * self-inflicted rate limit.
 */

/** Distinguishes our keys in a user's password manager and in leak scanners. */
const KEY_NAMESPACE = 'ev_live_';

/** Enough of the key to identify it in a list, too little to be worth stealing. */
export const API_KEY_PREFIX_LENGTH = 8;

export function generateApiKey(): string {
  // base64url so the key survives a URL, a header and a shell argument intact.
  return KEY_NAMESPACE + randomBytes(32).toString('base64url');
}

export function hashApiKey(rawKey: string): string {
  return createHash('sha256').update(rawKey, 'utf8').digest('hex');
}

/** The fragment stored alongside the hash and shown in the dashboard. */
export function apiKeyPrefix(rawKey: string): string {
  return rawKey.slice(0, KEY_NAMESPACE.length + API_KEY_PREFIX_LENGTH);
}

export interface CreatedApiKey {
  /** Shown once. Nothing can recover it afterwards, by design. */
  key: string;
  record: ApiKey;
}

export async function createApiKey(
  userId: string,
  name: string,
  options: { db?: Database } = {},
): Promise<CreatedApiKey> {
  const db = options.db ?? getDb();
  const key = generateApiKey();

  const [record] = await db
    .insert(apiKeys)
    .values({ userId, name, keyHash: hashApiKey(key), prefix: apiKeyPrefix(key) })
    .returning();

  if (record === undefined) throw new Error('failed to create API key');
  return { key, record };
}

/**
 * Resolves a raw key to its row, or null.
 *
 * There is no constant-time comparison here and none is needed: we look the
 * hash up by unique index rather than comparing secrets in JS, so the timing a
 * caller can observe is a b-tree probe, not a byte-by-byte match.
 */
export async function verifyApiKey(
  rawKey: string,
  options: { db?: Database; touch?: boolean } = {},
): Promise<ApiKey | null> {
  const db = options.db ?? getDb();

  const [record] = await db
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.keyHash, hashApiKey(rawKey)), isNull(apiKeys.revokedAt)))
    .limit(1);

  if (record === undefined) return null;
  if (options.touch !== false) await touchApiKey(record.id, { db });
  return record;
}

/**
 * Records use. Throttled to once a minute in SQL rather than in memory, because
 * every process would otherwise keep its own idea of "recently" — this is an
 * authentication path, and one extra write per key per minute is the whole cost.
 */
export async function touchApiKey(id: string, options: { db?: Database } = {}): Promise<void> {
  const db = options.db ?? getDb();
  await db
    .update(apiKeys)
    .set({ lastUsedAt: sql`now()` })
    .where(
      and(
        eq(apiKeys.id, id),
        sql`(${apiKeys.lastUsedAt} IS NULL OR ${apiKeys.lastUsedAt} < now() - interval '1 minute')`,
      ),
    );
}

/** Revoked, never deleted — a key that once had access should stay on the record. */
export async function revokeApiKey(id: string, options: { db?: Database } = {}): Promise<boolean> {
  const db = options.db ?? getDb();
  const revoked = await db
    .update(apiKeys)
    .set({ revokedAt: sql`now()` })
    .where(and(eq(apiKeys.id, id), isNull(apiKeys.revokedAt)))
    .returning({ id: apiKeys.id });
  return revoked.length > 0;
}

export async function listApiKeys(
  userId: string,
  options: { db?: Database } = {},
): Promise<ApiKey[]> {
  const db = options.db ?? getDb();
  return db.select().from(apiKeys).where(eq(apiKeys.userId, userId));
}
