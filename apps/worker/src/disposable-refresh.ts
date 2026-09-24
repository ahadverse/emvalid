import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { disposableRegistry } from '@ev/core';
import { config } from './config.ts';
import { log } from './log.ts';

/**
 * Keeps the disposable-domain list current — the upkeep half of feature 8.
 *
 * Detection is capped at roughly 85% for a reason no amount of code fixes: a
 * temp-mail service can register a domain this morning and no public list
 * knows about it until somebody notices. Refreshing daily narrows the gap; it
 * does not close it. That is why a disposable hit is `risky` and never
 * `undeliverable`.
 *
 * Two rules here, both about not making things worse:
 *   1. Merge, never replace. A truncated or empty download must not silently
 *      switch detection off.
 *   2. Keep a local copy. A worker that boots without internet still starts
 *      with yesterday's list instead of nothing.
 */

const SOURCE_URL =
  'https://raw.githubusercontent.com/disposable-email-domains/disposable-email-domains/master/disposable_email_blocklist.conf';

/** Below this the download is junk, whatever the HTTP status said. */
const MIN_PLAUSIBLE_ENTRIES = 1000;

const cachePath = () => join(config.dataDir, 'cache', 'disposable-domains.txt');

export async function refreshDisposableList(): Promise<void> {
  if (process.env.DISPOSABLE_REFRESH === 'off') {
    log.info('disposable.refresh_disabled', { size: disposableRegistry.size });
    return;
  }

  const cached = await loadCached();
  if (cached !== null) {
    disposableRegistry.add(cached);
    log.info('disposable.loaded_cache', { entries: cached.length, size: disposableRegistry.size });
  }

  try {
    const response = await fetch(SOURCE_URL, {
      signal: AbortSignal.timeout(30_000),
      headers: { accept: 'text/plain' },
    });

    if (!response.ok) {
      log.warn('disposable.refresh_failed', { status: response.status });
      return;
    }

    const domains = parseList(await response.text());

    if (domains.length < MIN_PLAUSIBLE_ENTRIES) {
      log.warn('disposable.refresh_rejected', { entries: domains.length });
      return;
    }

    disposableRegistry.add(domains);
    await saveCached(domains);

    log.info('disposable.refreshed', { entries: domains.length, size: disposableRegistry.size });
  } catch (error) {
    // Offline, DNS down, GitHub having a bad day — none of it is fatal. We
    // still have the seed list compiled into core plus whatever was cached.
    log.warn('disposable.refresh_error', {
      error: error instanceof Error ? error.message : String(error),
      size: disposableRegistry.size,
    });
  }
}

function parseList(body: string): string[] {
  return body
    .split(/\r?\n/)
    .map((line) => line.trim().toLowerCase())
    .filter((line) => line.length > 0 && !line.startsWith('#') && line.includes('.'));
}

async function loadCached(): Promise<string[] | null> {
  try {
    return parseList(await readFile(cachePath(), 'utf8'));
  } catch {
    return null;
  }
}

async function saveCached(domains: string[]): Promise<void> {
  try {
    await mkdir(dirname(cachePath()), { recursive: true });
    await writeFile(cachePath(), domains.join('\n'), 'utf8');
  } catch (error) {
    log.warn('disposable.cache_write_failed', { error: String(error) });
  }
}
