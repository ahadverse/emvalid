import { resolve } from 'node:path';
import { LocalStorage } from './local.ts';
import { S3Storage } from './s3.ts';
import type { ObjectStorage, StorageKind } from './types.ts';

/**
 * Picks a driver from the environment, once per process.
 *
 * The choice is made by whether a bucket is configured, not by NODE_ENV: a
 * production deploy without S3 credentials should fail loudly at the first
 * upload rather than quietly write to a container filesystem that is discarded
 * at the next deploy. Hence the secret check below, which is the one place
 * where production is treated differently.
 */

function env(name: string): string | undefined {
  const value = process.env[name];
  return value === undefined || value.trim() === '' ? undefined : value.trim();
}

function ttlSeconds(): number | undefined {
  const raw = env('STORAGE_URL_TTL_SECONDS');
  if (raw === undefined) return undefined;

  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`STORAGE_URL_TTL_SECONDS must be a positive number, got ${JSON.stringify(raw)}`);
  }
  return Math.floor(value);
}

export function storageKind(): StorageKind {
  const explicit = env('STORAGE_DRIVER');
  if (explicit === undefined) return env('S3_BUCKET') === undefined ? 'local' : 's3';
  if (explicit === 's3' || explicit === 'local') return explicit;

  throw new Error(`STORAGE_DRIVER must be "s3" or "local", got ${JSON.stringify(explicit)}`);
}

function required(name: string): string {
  const value = env(name);
  if (value === undefined) {
    throw new Error(`${name} is not set — see DEPLOY.md for the object storage variables`);
  }
  return value;
}

/**
 * Anchored on the working directory when relative. Both processes set an
 * absolute `DATA_DIR` before anything asks for storage (`next.config.ts` and
 * `apps/worker/src/config.ts`), because `./data` otherwise means a different
 * directory in each of them — the exact mismatch that used to make a download
 * 410 on a file that existed one directory over.
 */
function localRoot(): string {
  return resolve(env('DATA_DIR') ?? './data');
}

/**
 * A development default rather than a random value: a per-process secret would
 * invalidate every link the moment Next reloaded a route. In production there
 * is no default, because a guessable signing secret is a bucket anyone can
 * write to.
 */
function localSecret(): string {
  const configured = env('STORAGE_SIGNING_SECRET');
  if (configured !== undefined) return configured;

  if (process.env['NODE_ENV'] === 'production') {
    throw new Error(
      'STORAGE_SIGNING_SECRET is required when the local storage driver runs in production',
    );
  }
  return 'development-only-storage-secret';
}

export function createStorageFromEnv(): ObjectStorage {
  const ttl = ttlSeconds();

  if (storageKind() === 'local') {
    return new LocalStorage({
      root: localRoot(),
      secret: localSecret(),
      ...(env('STORAGE_BASE_PATH') === undefined ? {} : { basePath: env('STORAGE_BASE_PATH')! }),
      ...(ttl === undefined ? {} : { urlTtlSeconds: ttl }),
    });
  }

  const endpoint = env('S3_ENDPOINT');

  /*
   * Virtual-host style needs a DNS record per bucket, which in practice only
   * AWS provides. Every other endpoint — R2, Supabase, MinIO — wants path
   * style, so a configured endpoint is taken to mean "path style" unless the
   * deployment says otherwise.
   */
  const forcePathStyle = (() => {
    const raw = env('S3_FORCE_PATH_STYLE');
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    return endpoint !== undefined;
  })();

  return new S3Storage({
    bucket: required('S3_BUCKET'),
    // R2 has one region and calls it `auto`; S3 needs the real one.
    region: env('S3_REGION') ?? 'auto',
    accessKeyId: required('S3_ACCESS_KEY_ID'),
    secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
    ...(endpoint === undefined ? {} : { endpoint }),
    forcePathStyle,
    ...(ttl === undefined ? {} : { urlTtlSeconds: ttl }),
  });
}

/**
 * Next reloads modules on every edit in development. A module-level `let`
 * would hand out a fresh S3 client — and a fresh signing secret — on each
 * reload, so the handle hangs off globalThis, which survives it. Same trick,
 * same reason, as @ev/db's connection pool.
 */
const HANDLE = Symbol.for('@ev/storage.handle');

type GlobalWithHandle = typeof globalThis & { [HANDLE]?: ObjectStorage };

export function getStorage(): ObjectStorage {
  const global = globalThis as GlobalWithHandle;
  return (global[HANDLE] ??= createStorageFromEnv());
}
