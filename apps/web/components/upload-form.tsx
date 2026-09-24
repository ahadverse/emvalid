'use client';

import { useCallback, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Close, FileIcon, Spinner, Upload } from './icons';
import { buttonClass, Card, Notice } from './ui';
import { formatBytes } from '@/lib/format';

/**
 * Feature 14 — drag a list in, get a job out.
 *
 * Uploads over XMLHttpRequest rather than fetch for one reason: fetch cannot
 * report upload progress, and on a 600 MB file a UI that says nothing for four
 * minutes reads as broken.
 */

const ACCEPT = '.csv,.tsv,.txt,.xlsx,.xls';
const FORMATS = ['CSV', 'TSV', 'TXT', 'XLSX'] as const;

export function UploadForm() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const uploading = progress !== null;
  // 100% on the wire is not 100% done: the server still has to write the file
  // and enqueue the job. Saying "processing" there is the difference between a
  // progress bar that stalls and one that hands over.
  const handedOff = progress === 100;

  const choose = useCallback((chosen: File | null) => {
    setFailure(null);
    setFile(chosen);
  }, []);

  function onDrop(event: DragEvent<HTMLDivElement>): void {
    event.preventDefault();
    setDragging(false);
    if (uploading) return;
    choose(event.dataTransfer.files.item(0));
  }

  function onPick(event: ChangeEvent<HTMLInputElement>): void {
    choose(event.target.files?.item(0) ?? null);
  }

  function upload(): void {
    if (file === null || uploading) return;

    setFailure(null);
    setProgress(0);

    const body = new FormData();
    body.append('file', file, file.name);

    const request = new XMLHttpRequest();
    request.open('POST', '/api/upload');

    request.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) setProgress(Math.round((event.loaded / event.total) * 100));
    });

    request.addEventListener('load', () => {
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(request.responseText);
      } catch {
        // Falls through to the generic message below.
      }

      if (request.status >= 200 && request.status < 300) {
        const jobId = (parsed as { jobId?: string } | null)?.jobId;
        if (typeof jobId === 'string') {
          router.push(`/jobs/${jobId}`);
          return;
        }
      }

      setProgress(null);
      setFailure(
        (parsed as { error?: { message?: string } } | null)?.error?.message ??
          `Upload failed (HTTP ${request.status}).`,
      );
    });

    request.addEventListener('error', () => {
      setProgress(null);
      setFailure('The connection dropped during upload.');
    });

    request.addEventListener('abort', () => {
      setProgress(null);
      setFailure('Upload cancelled.');
    });

    request.send(body);
  }

  return (
    <Card className="h-full">
      <div className="border-b border-line px-5 py-4">
        <h2 className="text-[15px] font-semibold tracking-tight text-ink">Verify a list</h2>
        <p className="mt-1 text-[13px] leading-relaxed text-ink-muted">
          The file streams straight to disk, so size is not the limit — time is.
        </p>
      </div>

      <div className="px-5 py-5">
        <div
          onDragOver={(event) => {
            event.preventDefault();
            if (!uploading) setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={[
            'relative overflow-hidden rounded-xl border-2 border-dashed px-6 py-11 text-center',
            'transition-[border-color,background-color] duration-200',
            dragging
              ? 'border-accent bg-accent-soft'
              : 'border-line-strong bg-surface-sunken hover:border-ink-subtle/50',
          ].join(' ')}
        >
          <span
            aria-hidden
            className={[
              'mx-auto grid h-12 w-12 place-items-center rounded-xl border transition-colors duration-200',
              dragging
                ? 'border-accent-line bg-surface text-accent'
                : 'border-line bg-surface text-ink-subtle',
            ].join(' ')}
          >
            <Upload className="h-5 w-5" />
          </span>

          <p className="mt-4 text-sm font-medium text-ink">
            {dragging ? 'Release to attach' : 'Drop a file here'}
          </p>

          <div className="mt-2.5 flex flex-wrap items-center justify-center gap-1.5">
            {FORMATS.map((format) => (
              <span
                key={format}
                className="rounded border border-line bg-surface px-1.5 py-0.5 font-mono text-[10px] font-medium tracking-wide text-ink-subtle"
              >
                {format}
              </span>
            ))}
          </div>

          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT}
            onChange={onPick}
            className="hidden"
            aria-label="Choose a list file"
          />

          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className={buttonClass({ variant: 'secondary', size: 'sm', className: 'mt-5' })}
          >
            Choose file
          </button>
        </div>

        {file !== null && (
          <div className="mt-4 animate-rise rounded-xl border border-line bg-surface-sunken p-3.5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-line bg-surface text-ink-muted">
                  <FileIcon className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink">{file.name}</p>
                  <p className="text-[13px] tabular-nums text-ink-muted">
                    {formatBytes(file.size)}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {!uploading && (
                  <button
                    type="button"
                    onClick={() => choose(null)}
                    aria-label="Remove file"
                    className={buttonClass({
                      variant: 'ghost',
                      size: 'sm',
                      className: 'px-2',
                    })}
                  >
                    <Close className="h-4 w-4" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={upload}
                  disabled={uploading}
                  className={buttonClass({ size: 'sm' })}
                >
                  {uploading && <Spinner className="h-3.5 w-3.5" />}
                  {uploading
                    ? handedOff
                      ? 'Processing…'
                      : `Uploading ${progress}%`
                    : 'Start verification'}
                </button>
              </div>
            </div>

            {uploading && (
              <div
                className="mt-3.5 h-1.5 w-full overflow-hidden rounded-full bg-line"
                role="progressbar"
                aria-valuenow={progress}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="Upload progress"
              >
                <div
                  className={[
                    'h-full rounded-full bg-accent transition-[width] duration-200',
                    // Once the bytes are all sent the bar can no longer move,
                    // so it pulses instead of sitting frozen at full.
                    handedOff ? 'animate-pulse' : '',
                  ].join(' ')}
                  style={{ width: `${progress}%` }}
                />
              </div>
            )}
          </div>
        )}

        {failure !== null && (
          <div className="mt-4">
            <Notice tone="bad" title="Upload failed">
              {failure}
            </Notice>
          </div>
        )}
      </div>
    </Card>
  );
}
