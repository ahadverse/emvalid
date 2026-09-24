/**
 * Structured logging, one JSON object per line.
 *
 * A worker chewing through a ten-million-row job produces logs nobody reads
 * by eye — they get grepped and counted. JSON lines make that possible with
 * no logging dependency and no formatter to configure.
 */

type Fields = Record<string, unknown>;

function emit(level: 'info' | 'warn' | 'error', event: string, fields: Fields): void {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    event,
    ...fields,
  });
  if (level === 'error') process.stderr.write(`${line}\n`);
  else process.stdout.write(`${line}\n`);
}

export const log = {
  info: (event: string, fields: Fields = {}) => emit('info', event, fields),
  warn: (event: string, fields: Fields = {}) => emit('warn', event, fields),
  error: (event: string, fields: Fields = {}) => emit('error', event, fields),
};
