import 'server-only';

import {
  createApiKey as dbCreateApiKey,
  listApiKeys as dbListApiKeys,
  revokeApiKey as dbRevokeApiKey,
  type ApiKey,
} from '@ev/db';
import { maskedKey } from './auth';
import type { ApiKeySummary, CreatedApiKey } from './dto';

/**
 * Key management for the dashboard (feature 20's other half).
 *
 * Every operation is @ev/db's, wrapped only to (a) strip the hash before
 * anything reaches a browser and (b) scope by user — @ev/db's `revokeApiKey`
 * takes an id and nothing else, so ownership is checked here or nowhere.
 */

export type { ApiKeySummary, CreatedApiKey } from './dto';

const MAX_NAME_LENGTH = 60;

export function normalizeKeyName(input: unknown): string {
  const name = typeof input === 'string' ? input.trim() : '';
  if (name.length === 0) return 'Untitled key';
  return name.slice(0, MAX_NAME_LENGTH);
}

export async function listApiKeys(userId: string): Promise<ApiKeySummary[]> {
  const records = await dbListApiKeys(userId);

  // @ev/db returns them unordered; newest first is what the page wants.
  return records
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .map(toSummary);
}

export async function createApiKey(userId: string, name: string): Promise<CreatedApiKey> {
  const { key, record } = await dbCreateApiKey(userId, name);
  return { ...toSummary(record), raw: key };
}

/**
 * Revocation is a timestamp, not a delete — a key that authenticated a job last
 * month still has to be explicable next month.
 *
 * The ownership check is a separate read because @ev/db revokes by id alone.
 * Two queries for an action a user performs a handful of times is a fair price
 * for not letting an id from another account revoke a key.
 */
export async function revokeApiKey(userId: string, keyId: string): Promise<boolean> {
  const owned = await dbListApiKeys(userId);
  if (!owned.some((record) => record.id === keyId)) return false;

  return dbRevokeApiKey(keyId);
}

/** Drops `keyHash` — the one field that must never cross to the client. */
function toSummary(record: ApiKey): ApiKeySummary {
  return {
    id: record.id,
    name: record.name,
    prefix: record.prefix,
    masked: maskedKey(record.prefix),
    createdAt: record.createdAt.toISOString(),
    lastUsedAt: record.lastUsedAt?.toISOString() ?? null,
    revokedAt: record.revokedAt?.toISOString() ?? null,
  };
}
