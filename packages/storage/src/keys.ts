/**
 * Storage keys, in one place.
 *
 * Two of these round-trip through the database and come back as the input to a
 * file operation, so `isStorageKey` is a security check and not a tidiness one.
 * It is also what quarantines pre-split rows: those hold absolute filesystem
 * paths from the single-VPS era, every one of which fails this test, so the
 * download route answers 404 rather than reaching for a path on a machine that
 * no longer exists.
 */

/** One path segment: no dots-only names, no separators, no drive letters. */
const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

const MAX_KEY_LENGTH = 512;
const MAX_SEGMENTS = 8;

export const UPLOAD_PREFIX = 'uploads';
export const RESULT_PREFIX = 'results';

/**
 * The upload is keyed on its own id, not on the job's: the row cannot exist
 * until the file has landed, and the file cannot be stored until it has a key.
 *
 * The owner is in the key, and that is load-bearing. Uploading is two requests
 * — "sign me a URL", then "the bytes are there, queue it" — and the second one
 * must not be able to name somebody else's object. Because the key is rebuilt
 * from the session's own user id, it cannot: the worst a forged upload id can
 * reach is a slot in the caller's own namespace.
 */
export function uploadKey(userId: string, uploadId: string, extension: string): string {
  return `${UPLOAD_PREFIX}/${userId}/${uploadId}/input${extension}`;
}

export function resultKey(jobId: string, extension: string): string {
  return `${RESULT_PREFIX}/${jobId}${extension}`;
}

export function isStorageKey(value: string): boolean {
  if (value.length === 0 || value.length > MAX_KEY_LENGTH) return false;

  const segments = value.split('/');
  if (segments.length > MAX_SEGMENTS) return false;

  // `SAFE_SEGMENT` already rejects a leading dot, so `.` and `..` cannot get
  // through — and with them every form of traversal, since a key holds no
  // other separator.
  return segments.every((segment) => SAFE_SEGMENT.test(segment));
}

export class StorageKeyError extends Error {
  constructor(key: string) {
    super(`Not a storage key: ${JSON.stringify(key.slice(0, 120))}`);
    this.name = 'StorageKeyError';
  }
}

export function assertStorageKey(key: string): string {
  if (!isStorageKey(key)) throw new StorageKeyError(key);
  return key;
}
