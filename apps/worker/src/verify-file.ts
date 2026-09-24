import { EmailValidator, MemoryDomainCache } from '@ev/core';
import { processFile } from '@ev/pipeline';
import { config } from './config.ts';

/**
 * `pnpm --filter @ev/worker verify <input.csv> <output.csv>`
 *
 * The whole engine with no database and no queue attached. It exists because
 * the first question anyone asks of a list cleaner is "what does it say about
 * my actual file", and making them stand up Postgres to find out is a bad
 * answer. Also the fastest way to sanity-check a change to the classifier
 * against real data.
 */

const [inputPath, outputPath] = process.argv.slice(2);

if (inputPath === undefined || outputPath === undefined) {
  console.error('usage: verify <input.csv|xlsx> <output.csv>');
  process.exit(2);
}

// Memory cache only — a one-off run should not need or touch the database.
const validator = new EmailValidator({
  cache: new MemoryDomainCache(),
  servers: config.dnsServers,
  timeout: config.dnsTimeoutMs,
  concurrency: config.dnsConcurrency,
});

const started = Date.now();

const { summary, column, format } = await processFile({
  inputPath,
  outputPath,
  validator,
  batchSize: config.batchSize,
  onProgress: ({ processed }) => process.stderr.write(`\r${processed} rows...`),
});

process.stderr.write('\r');

const seconds = ((Date.now() - started) / 1000).toFixed(1);
const pct = (n: number) => (summary.total === 0 ? '0.0' : ((n / summary.total) * 100).toFixed(1));

console.log(`${format} file, column ${column.index + 1} (${column.confidence}% confident)`);
console.log(`  ${column.reason}`);
console.log(`\n${summary.total} addresses in ${seconds}s`);
console.log(`  ${validator.resolver.stats.dnsQueries} DNS lookups, ${validator.resolver.stats.cacheHits} cache hits`);
if (summary.duplicates > 0) console.log(`  ${summary.duplicates} duplicates removed`);

console.log('\nWhat to do');
const ADVICE_LABELS = {
  send: 'keep — safe to send',
  review: 'check first',
  do_not_send: 'remove',
  retry: 'retry (we were blocked)',
} as const;
for (const [advice, count] of Object.entries(summary.byAdvice)) {
  if (count > 0) {
    const label = ADVICE_LABELS[advice as keyof typeof ADVICE_LABELS];
    console.log(`  ${label.padEnd(24)} ${String(count).padStart(7)}  ${pct(count).padStart(5)}%`);
  }
}

console.log('\nStatus (what we established)');
for (const [status, count] of Object.entries(summary.byStatus)) {
  if (count > 0) console.log(`  ${status.padEnd(15)} ${String(count).padStart(7)}  ${pct(count).padStart(5)}%`);
}

console.log('\nReason');
for (const [reason, count] of Object.entries(summary.byReason).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${reason.padEnd(24)} ${String(count).padStart(7)}`);
}

if (Object.keys(summary.byProvider).length > 0) {
  console.log('\nMail provider');
  for (const [provider, count] of Object.entries(summary.byProvider).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${provider.padEnd(15)} ${String(count).padStart(7)}`);
  }
}

// The honest headline, printed last so it is the thing left on screen.
console.log(`\nCoverage ${summary.coverage}% — we gave a firm answer on that share.`);
console.log(
  `The remaining ${pct(summary.byStatus.unknown)}% is unknown: the domain accepts mail, ` +
    'but the individual mailbox was not confirmed.',
);
if (summary.retryable > 0) {
  console.log(`\n${summary.retryable} rows hit a DNS failure and deserve a retry — they are not verdicts.`);
}
