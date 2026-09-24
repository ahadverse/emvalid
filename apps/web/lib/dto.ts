import type { JobSummary } from '@ev/core';
import type { JobStatus } from './format';

/**
 * The shapes that cross the network — server to browser, and out over the
 * public API.
 *
 * They live in their own file, free of `server-only`, because the client
 * components need the types and nothing else from the modules that produce
 * them. Importing them from lib/jobs.ts would work today (a type-only import
 * is erased) but it puts a database module one dropped `type` keyword away
 * from a client bundle. This file removes that possibility instead of relying
 * on everyone remembering.
 *
 * Everything here is JSON-safe: timestamps are ISO strings, never `Date`.
 */

export interface JobRecord {
  id: string;
  status: JobStatus;
  originalFilename: string;
  /** 0 until the worker has read the file and knows the real count. */
  totalRows: number;
  processedRows: number;
  /** Feature 18 — present only once the job has completed. */
  summary: JobSummary | null;
  error: string | null;
  attempts: number;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  /** Feature 24 — when retention deletes the rows and the result file. */
  expiresAt: string | null;
  downloadable: boolean;
}

/** Safe to send to a browser — no hash, no raw key. */
export interface ApiKeySummary {
  id: string;
  name: string;
  prefix: string;
  masked: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export interface CreatedApiKey extends ApiKeySummary {
  /** The only moment this value exists outside the caller's clipboard. */
  raw: string;
}
