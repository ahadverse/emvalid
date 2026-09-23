/**
 * The shape every reader in this package agrees on.
 *
 * One row at a time, as raw cell strings. Nothing here is ever an array of
 * rows: a job may be ten million rows and the only reason this package can
 * touch one is that a row is read, used and dropped before the next arrives.
 */
export type RowSource = AsyncIterable<string[]>;

export type SourceFormat = 'csv' | 'xlsx';
