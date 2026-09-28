import { Readable } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { LocalStorage } from '@ev/storage';
import { jsonError, withErrors } from '@/lib/http';
import { getStorage } from '@/lib/storage';

/**
 * The local storage driver's bucket endpoint.
 *
 * In production the browser PUTs to S3 and is redirected to S3, and none of
 * this runs. On a laptop there is no S3, and the alternative to this route is
 * a second upload path in the client that only ever executes in development —
 * which is the path that quietly stops working. So the driver hands out signed
 * links to here instead, and the upload form has one code path for both.
 *
 * Authorisation is the signature and nothing else. There is no session check,
 * deliberately: that is exactly the property an S3 presigned URL has, and a
 * development stand-in that were stricter would hide the mistakes it exists to
 * reproduce. The link names one key and one verb and expires in minutes.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Context {
  params: Promise<{ key: string[] }>;
}

export const PUT = withErrors(async (request: Request, context: Context) => {
  const checked = await authorise(request, context, 'put');
  if (!checked.ok) return checked.response;

  if (request.body === null) {
    return jsonError('bad_request', 'Request has no body.', 400);
  }

  // Streamed through, never collected: the body on this route is the whole
  // uploaded list.
  await checked.storage.put(checked.key, Readable.fromWeb(request.body as WebReadableStream));

  return new Response(null, { status: 200 });
});

export const GET = withErrors(async (request: Request, context: Context) => {
  const checked = await authorise(request, context, 'get');
  if (!checked.ok) return checked.response;

  const url = new URL(request.url);
  const filename = url.searchParams.get('name') ?? 'download';
  const contentType = url.searchParams.get('type') ?? 'application/octet-stream';

  const info = await checked.storage.head(checked.key);
  if (info === null) {
    return jsonError('gone', 'That object no longer exists.', 410);
  }

  // Streamed rather than read: the result of a ten-million-row job is larger
  // than the input, and buffering it here would undo everything the pipeline
  // does to keep memory flat. The driver owns the key-to-path step, so this
  // route never gets to have an opinion about where the root is.
  const stream = Readable.toWeb(checked.storage.openRead(checked.key)) as ReadableStream<Uint8Array>;

  return new Response(stream, {
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(info.size),
      'Content-Disposition': contentDisposition(filename),
      'Cache-Control': 'no-store',
    },
  });
});

type Authorised =
  | { ok: true; storage: LocalStorage; key: string }
  | { ok: false; response: Response };

async function authorise(
  request: Request,
  context: Context,
  action: 'put' | 'get',
): Promise<Authorised> {
  const storage = getStorage();

  // A 404 rather than a 400: with S3 configured this path is not part of the
  // app's surface at all, and saying so invites nobody to look further.
  if (!(storage instanceof LocalStorage)) {
    return { ok: false, response: jsonError('not_found', 'Not found.', 404) };
  }

  const { key: segments } = await context.params;
  const key = segments.join('/');

  const url = new URL(request.url);
  const expiresAt = Number(url.searchParams.get('exp') ?? '');
  const signature = url.searchParams.get('sig') ?? '';

  if (!storage.verify(action, key, expiresAt, signature)) {
    return { ok: false, response: jsonError('forbidden', 'This link is not valid.', 403) };
  }

  return { ok: true, storage, key };
}

function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
