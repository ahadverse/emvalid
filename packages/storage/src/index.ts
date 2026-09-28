/**
 * @ev/storage — the shared disk the deployment no longer has.
 *
 * The web app runs on Vercel and the worker on Render, so a job's input and
 * result cross between them through an object store rather than a directory.
 * `types.ts` explains the shape; this file is only the door.
 */

export type {
  ObjectInfo,
  ObjectStorage,
  PresignDownloadOptions,
  PresignUploadOptions,
  PresignedUpload,
  StorageKind,
} from './types.ts';

export {
  RESULT_PREFIX,
  StorageKeyError,
  UPLOAD_PREFIX,
  assertStorageKey,
  isStorageKey,
  resultKey,
  uploadKey,
} from './keys.ts';

export { LocalStorage, type LocalStorageOptions } from './local.ts';
export { S3Storage, type S3StorageOptions } from './s3.ts';
export { createStorageFromEnv, getStorage, storageKind } from './factory.ts';
export { signLink, verifyLink, type SignedAction } from './signing.ts';
