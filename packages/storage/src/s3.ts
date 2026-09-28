import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { assertStorageKey } from './keys.ts';
import type {
  ObjectInfo,
  ObjectStorage,
  PresignDownloadOptions,
  PresignUploadOptions,
  PresignedUpload,
} from './types.ts';

/**
 * Any S3-compatible bucket: Cloudflare R2, AWS S3, Supabase Storage, Backblaze
 * B2, MinIO. Deliberately nothing vendor-specific — the product's data is the
 * customer's list, and being able to move it to another provider in an
 * afternoon is worth more than any one provider's convenience API.
 */

const DEFAULT_TTL_SECONDS = 900;

/**
 * 8 MiB parts. The multipart threshold matters on the worker's upload path,
 * where a ten-million-row result is a real file: smaller parts mean more round
 * trips, larger ones mean more memory held per part in flight.
 */
const PART_SIZE = 8 * 1024 * 1024;

export interface S3StorageOptions {
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** R2, Supabase and MinIO all need this. Plain AWS S3 does not. */
  endpoint?: string;
  forcePathStyle?: boolean;
  urlTtlSeconds?: number;
}

export class S3Storage implements ObjectStorage {
  readonly kind = 's3' as const;

  readonly #client: S3Client;
  readonly #bucket: string;
  readonly #ttl: number;

  constructor(options: S3StorageOptions) {
    this.#bucket = options.bucket;
    this.#ttl = options.urlTtlSeconds ?? DEFAULT_TTL_SECONDS;
    this.#client = new S3Client({
      region: options.region,
      credentials: {
        accessKeyId: options.accessKeyId,
        secretAccessKey: options.secretAccessKey,
      },
      /*
       * Off unless an operation actually demands it, because of what it does to
       * `presignUpload`. Left on, the SDK checksums the body it has at signing
       * time — which for a presigned URL is no body at all — and bakes
       * `x-amz-checksum-crc32=AAAAAA==`, the CRC32 of zero bytes, into the query
       * string. The browser then PUTs the real file against a URL that already
       * swore the file was empty, and the bucket rejects it. Nothing in the
       * signature is wrong, so the error says nothing about checksums.
       *
       * The integrity guarantee this gives up is one we were not using: every
       * PUT here is over TLS to a length-checked object, and the worker verifies
       * what it reads back by parsing it.
       */
      requestChecksumCalculation: 'WHEN_REQUIRED',
      ...(options.endpoint === undefined ? {} : { endpoint: options.endpoint }),
      ...(options.forcePathStyle === undefined ? {} : { forcePathStyle: options.forcePathStyle }),
    });
  }

  /**
   * No `ContentType` on the command, on purpose.
   *
   * Anything named in the command is signed into the URL, and a signed header
   * the browser then has to reproduce exactly is a mismatch waiting to happen
   * — browsers pick their own Content-Type for a File, and a CSV picked from
   * Windows arrives as `application/vnd.ms-excel` often enough to matter. The
   * stored type is never read back anyway: the download URL sets the response
   * type explicitly.
   */
  async presignUpload(key: string, options: PresignUploadOptions = {}): Promise<PresignedUpload> {
    assertStorageKey(key);
    const expiresInSeconds = options.expiresInSeconds ?? this.#ttl;

    const url = await getSignedUrl(
      this.#client,
      new PutObjectCommand({ Bucket: this.#bucket, Key: key }),
      { expiresIn: expiresInSeconds },
    );

    return { url, method: 'PUT', headers: {}, expiresInSeconds };
  }

  /**
   * The filename and type are query parameters the bucket echoes into the
   * response, which is what makes a redirect straight to storage produce a
   * sensibly named download instead of `results/<uuid>.csv`.
   */
  presignDownload(key: string, options: PresignDownloadOptions): Promise<string> {
    assertStorageKey(key);

    return getSignedUrl(
      this.#client,
      new GetObjectCommand({
        Bucket: this.#bucket,
        Key: key,
        ResponseContentType: options.contentType,
        ResponseContentDisposition: contentDisposition(options.filename),
      }),
      { expiresIn: options.expiresInSeconds ?? this.#ttl },
    );
  }

  async head(key: string): Promise<ObjectInfo | null> {
    assertStorageKey(key);

    try {
      const info = await this.#client.send(
        new HeadObjectCommand({ Bucket: this.#bucket, Key: key }),
      );
      return { size: info.ContentLength ?? 0 };
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async put(key: string, body: Readable, options: { contentType?: string } = {}): Promise<void> {
    assertStorageKey(key);
    await this.#upload(key, body, options.contentType);
  }

  async fetchToFile(key: string, destination: string): Promise<void> {
    assertStorageKey(key);

    const target = resolve(destination);
    await mkdir(dirname(target), { recursive: true });

    const object = await this.#client.send(
      new GetObjectCommand({ Bucket: this.#bucket, Key: key }),
    );
    if (object.Body === undefined) {
      throw new Error(`Object has no body: ${key}`);
    }

    // In Node the SDK hands back a Readable; the union in the types covers the
    // browser build, which this package never runs in.
    await pipeline(object.Body as Readable, createWriteStream(target));
  }

  async sendFile(key: string, source: string, options: { contentType?: string } = {}): Promise<void> {
    assertStorageKey(key);

    const path = resolve(source);
    const info = await stat(path);

    // Under the part size there is nothing to multipart, and a single PUT with
    // a known length is one request instead of three.
    if (info.size <= PART_SIZE) {
      await this.#client.send(
        new PutObjectCommand({
          Bucket: this.#bucket,
          Key: key,
          Body: createReadStream(path),
          ContentLength: info.size,
          ...(options.contentType === undefined ? {} : { ContentType: options.contentType }),
        }),
      );
      return;
    }

    await this.#upload(key, createReadStream(path), options.contentType);
  }

  async remove(key: string): Promise<void> {
    assertStorageKey(key);
    await this.#client.send(new DeleteObjectCommand({ Bucket: this.#bucket, Key: key }));
  }

  /** Multipart, so a body of unknown length never has to be buffered to learn it. */
  async #upload(key: string, body: Readable, contentType: string | undefined): Promise<void> {
    const upload = new Upload({
      client: this.#client,
      partSize: PART_SIZE,
      // One part at a time. The worker is already saturating its network and
      // its memory ceiling is the reason the pipeline streams at all.
      queueSize: 1,
      params: {
        Bucket: this.#bucket,
        Key: key,
        Body: body,
        ...(contentType === undefined ? {} : { ContentType: contentType }),
      },
    });

    await upload.done();
  }
}

/**
 * Two filenames: a stripped ASCII one every client understands, and an
 * RFC 5987 one for anything else. The strip is also what stops a quote in a
 * user-supplied name from breaking out of the header.
 */
function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

/**
 * S3 answers a missing key with 404 and a `NotFound`/`NoSuchKey` name, but
 * which of the two depends on the operation and the provider, so the status
 * code is what is actually checked.
 */
function isNotFound(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;

  const metadata = (error as { $metadata?: { httpStatusCode?: number } }).$metadata;
  if (metadata?.httpStatusCode === 404) return true;

  const name = (error as { name?: string }).name;
  return name === 'NotFound' || name === 'NoSuchKey';
}
