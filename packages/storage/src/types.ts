import type { Readable } from 'node:stream';

/**
 * Where a job's bytes live.
 *
 * On one VPS the web app and the worker shared a directory, and a job was
 * handed over by writing a file one process and reading it in the other. Split
 * across Vercel and Render there is no such directory — Vercel's filesystem is
 * per-invocation and a Render disk attaches to exactly one service — so the
 * handover goes through an object store instead.
 *
 * Both halves talk to it through this interface and neither knows which driver
 * is behind it: S3-compatible storage in production, a plain directory on a
 * laptop. Nothing above this file changes between the two, which is the point:
 * a bug that only appears on the deployed pair is a bug nobody can reproduce.
 *
 * Keys, not paths. `jobs.input_path` now holds `uploads/<id>/input.csv`,
 * relative to the bucket, and is deliberately meaningless as a filesystem path
 * — see `keys.ts` for why that matters to the download route.
 */

export type StorageKind = 's3' | 'local';

/**
 * Everything a client needs to send the bytes itself, without them passing
 * through our server at all.
 *
 * This is not an optimisation. A Vercel function cannot receive a request body
 * larger than a few megabytes, so for a product whose ordinary input is a
 * 600 MB list, "the browser uploads directly" is the only shape that works.
 */
export interface PresignedUpload {
  url: string;
  method: 'PUT';
  /**
   * Sent verbatim. A driver that signs a header into the URL needs that header
   * on the request too, or the signature will not match.
   */
  headers: Record<string, string>;
  expiresInSeconds: number;
}

export interface PresignUploadOptions {
  expiresInSeconds?: number;
}

export interface PresignDownloadOptions {
  /** Offered to the browser as the saved filename. */
  filename: string;
  contentType: string;
  expiresInSeconds?: number;
}

export interface ObjectInfo {
  size: number;
}

export interface ObjectStorage {
  readonly kind: StorageKind;

  presignUpload(key: string, options?: PresignUploadOptions): Promise<PresignedUpload>;
  presignDownload(key: string, options: PresignDownloadOptions): Promise<string>;

  /**
   * `null` for a missing object rather than a throw: the caller asking is the
   * upload-completion check, where "the client never sent it" is an ordinary
   * answer and not an error.
   */
  head(key: string): Promise<ObjectInfo | null>;

  /** Streamed — the caller may be forwarding a body whose length it never learns. */
  put(key: string, body: Readable, options?: { contentType?: string }): Promise<void>;

  /**
   * Bytes in, local file out. @ev/pipeline reads from a path and streams its
   * way through a file far larger than memory; handing it a network stream
   * instead would mean a dropped connection halfway is an unrecoverable job.
   */
  fetchToFile(key: string, destination: string): Promise<void>;

  /** Local file in, bytes out. The other half of the same bargain. */
  sendFile(key: string, source: string, options?: { contentType?: string }): Promise<void>;

  /** Idempotent: an object that is already gone is the desired end state. */
  remove(key: string): Promise<void>;
}
