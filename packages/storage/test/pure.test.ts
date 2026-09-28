import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { after, before, describe, it } from 'node:test';
import { isStorageKey, resultKey, uploadKey } from '../src/keys.ts';
import { LocalStorage } from '../src/local.ts';
import { signLink, verifyLink } from '../src/signing.ts';

/**
 * Everything here is pure or touches only a temporary directory. The S3 driver
 * is not exercised — a test that needs credentials is a test nobody runs — so
 * what is covered is the part that is ours: which keys are allowed, which
 * links are honoured, and that the local driver is a faithful enough stand-in
 * to develop against.
 */

const USER = '11111111-2222-3333-4444-555555555555';
const UPLOAD = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

describe('storage keys', () => {
  it('scopes an upload to its owner', () => {
    const key = uploadKey(USER, UPLOAD, '.csv');
    assert.equal(key, `uploads/${USER}/${UPLOAD}/input.csv`);
    assert.ok(isStorageKey(key));
  });

  it('names a result after its job', () => {
    assert.equal(resultKey('job-1', '.xlsx'), 'results/job-1.xlsx');
  });

  it('refuses anything that could climb out of the bucket', () => {
    for (const bad of [
      '../secrets.csv',
      'uploads/../../etc/passwd',
      'uploads/./input.csv',
      '/var/data/results/x.csv',
      'results/x.csv/../../y',
      '',
    ]) {
      assert.equal(isStorageKey(bad), false, bad);
    }
  });

  it('refuses the absolute paths that pre-split rows hold', () => {
    // These are what `jobs.input_path` contained when both halves shared a
    // disk. They must not reach a file operation now that they cannot be true.
    assert.equal(isStorageKey('E:\\Ahad\\data\\uploads\\x\\input.csv'), false);
    assert.equal(isStorageKey('/home/ev/data/results/x.csv'), false);
  });
});

describe('signed links', () => {
  const secret = 'test-secret';
  const soon = Math.floor(Date.now() / 1000) + 60;

  it('accepts a link it just issued', () => {
    const signature = signLink(secret, 'get', 'results/a.csv', soon);
    assert.ok(verifyLink(secret, 'get', 'results/a.csv', soon, signature));
  });

  it('refuses a link reused for the other verb', () => {
    // A read link must not become a write link, or one download would be a
    // licence to overwrite the object it downloaded.
    const signature = signLink(secret, 'get', 'results/a.csv', soon);
    assert.equal(verifyLink(secret, 'put', 'results/a.csv', soon, signature), false);
  });

  it('refuses a link pointed at a different key', () => {
    const signature = signLink(secret, 'get', 'results/a.csv', soon);
    assert.equal(verifyLink(secret, 'get', 'results/b.csv', soon, signature), false);
  });

  it('refuses an expired link even though the signature is genuine', () => {
    const past = Math.floor(Date.now() / 1000) - 1;
    const signature = signLink(secret, 'get', 'results/a.csv', past);
    assert.equal(verifyLink(secret, 'get', 'results/a.csv', past, signature), false);
  });

  it('refuses a signature of the right shape but the wrong secret', () => {
    const signature = signLink('other-secret', 'get', 'results/a.csv', soon);
    assert.equal(verifyLink(secret, 'get', 'results/a.csv', soon, signature), false);
  });
});

describe('LocalStorage', () => {
  let root = '';
  let storage: LocalStorage;

  before(async () => {
    root = await mkdtemp(join(tmpdir(), 'ev-storage-'));
    storage = new LocalStorage({ root, secret: 'test-secret' });
  });

  after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('round-trips a stream through a key', async () => {
    const key = uploadKey(USER, UPLOAD, '.csv');
    await storage.put(key, Readable.from(['email\n', 'a@b.com\n']));

    assert.deepEqual(await storage.head(key), { size: 14 });

    const destination = join(root, 'fetched.csv');
    await storage.fetchToFile(key, destination);
    assert.equal(await readFile(destination, 'utf8'), 'email\na@b.com\n');
  });

  it('sends a local file up and reports it gone once removed', async () => {
    const source = join(root, 'result.csv');
    await writeFile(source, 'ok', 'utf8');

    const key = resultKey('job-2', '.csv');
    await storage.sendFile(key, source);
    assert.deepEqual(await storage.head(key), { size: 2 });

    await storage.remove(key);
    assert.equal(await storage.head(key), null);
  });

  it('treats an object that was never there as already gone', async () => {
    // The retention sweep depends on this: an interrupted earlier sweep is the
    // likeliest reason for a missing object, and the end state is the same.
    await storage.remove(resultKey('never-existed', '.csv'));
  });

  it('answers a missing object with null rather than throwing', async () => {
    assert.equal(await storage.head(resultKey('absent', '.csv')), null);
  });

  it('issues an upload link its own verifier accepts', async () => {
    const key = uploadKey(USER, UPLOAD, '.csv');
    const upload = await storage.presignUpload(key);

    assert.equal(upload.method, 'PUT');
    assert.ok(upload.url.startsWith(`/api/storage/${key}?`));

    const query = new URL(upload.url, 'http://localhost').searchParams;
    assert.ok(
      storage.verify('put', key, Number(query.get('exp')), query.get('sig') ?? ''),
      'the driver should accept the link it just issued',
    );
  });

  it('carries the download filename in the link, not in the signature', async () => {
    // The route reads it back to build Content-Disposition. Tampering with it
    // can only change what the downloader's own file is called.
    const url = await storage.presignDownload(resultKey('job-3', '.csv'), {
      filename: 'তালিকা-verified.csv',
      contentType: 'text/csv',
    });

    const query = new URL(url, 'http://localhost').searchParams;
    assert.equal(query.get('name'), 'তালিকা-verified.csv');
    assert.equal(query.get('type'), 'text/csv');
  });

  it('refuses to turn a traversal into a path', async () => {
    await assert.rejects(() => storage.put('../escape.csv', Readable.from(['x'])));
    await assert.rejects(() => storage.head('uploads/../../etc/passwd'));
  });
});
