import 'server-only';

/**
 * The app's door to @ev/storage.
 *
 * It exists for the `server-only` line: every one of these functions holds
 * bucket credentials or mints a signed URL, and a stray import from a client
 * component should fail the build rather than ship either to a browser.
 */

export {
  assertStorageKey,
  getStorage,
  isStorageKey,
  resultKey,
  storageKind,
  uploadKey,
  type ObjectStorage,
  type PresignedUpload,
} from '@ev/storage';
