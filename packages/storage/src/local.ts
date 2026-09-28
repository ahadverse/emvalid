import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rm, stat } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { assertStorageKey } from './keys.ts';
import { signLink, verifyLink, type SignedAction } from './signing.ts';
import type {
  ObjectInfo,
  ObjectStorage,
  PresignDownloadOptions,
  PresignUploadOptions,
  PresignedUpload,
} from './types.ts';

/**
 * A directory pretending to be a bucket.
 *
 * This is what runs on a laptop, and what would run on a single VPS if the
 * product ever went back to one. It is not a fallback for a misconfigured
 * production deploy — the factory picks it only when no bucket is configured
 * at all, and it refuses to sign anything in production without a real secret.
 */

const DEFAULT_TTL_SECONDS = 900;

export interface LocalStorageOptions {
  /** Absolute. The caller resolves it, because "relative to what" differs per process. */
  root: string;
  secret: string;
  /** The route that serves the links this driver hands out. */
  basePath?: string;
  urlTtlSeconds?: number;
}

export class LocalStorage implements ObjectStorage {
  readonly kind = 'local' as const;

  readonly #root: string;
  readonly #secret: string;
  readonly #basePath: string;
  readonly #ttl: number;

  constructor(options: LocalStorageOptions) {
    this.#root = resolve(options.root);
    this.#secret = options.secret;
    this.#basePath = (options.basePath ?? '/api/storage').replace(/\/+$/, '');
    this.#ttl = options.urlTtlSeconds ?? DEFAULT_TTL_SECONDS;
  }

  /**
   * Relative, not absolute. The browser resolves it against the page it is on,
   * so this driver never has to be told the app's own origin — which it could
   * only be told wrongly.
   */
  #link(action: SignedAction, key: string, expiresInSeconds: number, extra = ''): string {
    const expiresAt = Math.floor(Date.now() / 1000) + expiresInSeconds;
    const signature = signLink(this.#secret, action, key, expiresAt);
    return `${this.#basePath}/${key}?exp=${expiresAt}&sig=${signature}${extra}`;
  }

  presignUpload(key: string, options: PresignUploadOptions = {}): Promise<PresignedUpload> {
    assertStorageKey(key);
    const expiresInSeconds = options.expiresInSeconds ?? this.#ttl;

    return Promise.resolve({
      url: this.#link('put', key, expiresInSeconds),
      method: 'PUT' as const,
      headers: {},
      expiresInSeconds,
    });
  }

  presignDownload(key: string, options: PresignDownloadOptions): Promise<string> {
    assertStorageKey(key);
    const expiresInSeconds = options.expiresInSeconds ?? this.#ttl;

    // The filename rides in the URL rather than in the signature: the route
    // reads it back to build Content-Disposition, and a tampered one can only
    // change what the downloader's own file is called.
    const extra =
      `&name=${encodeURIComponent(options.filename)}` +
      `&type=${encodeURIComponent(options.contentType)}`;

    return Promise.resolve(this.#link('get', key, expiresInSeconds, extra));
  }

  /**
   * Verifies a link this driver issued. Lives here, next to the code that
   * creates them, so the route handler holds no opinion about the format.
   */
  verify(action: SignedAction, key: string, expiresAt: number, signature: string): boolean {
    return isStorageKeySafe(key) && verifyLink(this.#secret, action, key, expiresAt, signature);
  }

  async head(key: string): Promise<ObjectInfo | null> {
    // Resolved outside the try, so a malformed key throws rather than being
    // reported as "not there". The two are not the same thing: one is a client
    // that never uploaded, the other is a bug, and the S3 driver would have
    // thrown too.
    const path = this.#path(key);

    try {
      const info = await stat(path);
      return info.isFile() ? { size: info.size } : null;
    } catch {
      return null;
    }
  }

  async put(key: string, body: Readable): Promise<void> {
    const path = this.#path(key);
    await mkdir(dirname(path), { recursive: true });
    await pipeline(body, createWriteStream(path));
  }

  /**
   * For the route that serves this driver's signed GET links. Not on
   * `ObjectStorage`: with S3 the equivalent never happens in our process at
   * all — the browser is redirected at the bucket — and putting it on the
   * interface would invite somebody to proxy a ten-million-row result through
   * a serverless function.
   */
  openRead(key: string): Readable {
    return createReadStream(this.#path(key));
  }

  async fetchToFile(key: string, destination: string): Promise<void> {
    await mkdir(dirname(resolve(destination)), { recursive: true });
    await pipeline(createReadStream(this.#path(key)), createWriteStream(resolve(destination)));
  }

  async sendFile(key: string, source: string): Promise<void> {
    const path = this.#path(key);
    await mkdir(dirname(path), { recursive: true });
    await pipeline(createReadStream(resolve(source)), createWriteStream(path));
  }

  async remove(key: string): Promise<void> {
    await rm(this.#path(key), { force: true });
  }

  /** The one place a key becomes a path, so the one place that can get it wrong. */
  #path(key: string): string {
    assertStorageKey(key);
    const path = join(this.#root, ...key.split('/'));

    // Belt and braces. `assertStorageKey` already makes traversal impossible;
    // this catches the day somebody loosens it.
    if (path !== this.#root && !path.startsWith(this.#root + sep)) {
      throw new Error(`Resolved path escapes the storage root: ${key}`);
    }
    return path;
  }
}

function isStorageKeySafe(key: string): boolean {
  try {
    assertStorageKey(key);
    return true;
  } catch {
    return false;
  }
}
