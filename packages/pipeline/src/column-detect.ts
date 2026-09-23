/**
 * Which column holds the addresses.
 *
 * This is the highest-stakes guess in the whole pipeline, and it fails
 * silently: pick the wrong column and every row comes back `syntax_invalid`,
 * the summary looks plausible, and the user is told their list is dead. So the
 * detector never returns a bare index — it returns how sure it is and the
 * sentence that explains the choice, and the caller is expected to show both.
 *
 * Two signals, in order: the header name, then the data itself. The data is
 * allowed to overrule the header, because a column called `email` that holds
 * no `@` is a lie and the column next to it is usually the truth.
 */

export interface ColumnDetection {
  /** Zero-based. Always a real column unless the file had none. */
  index: number;
  /** True when row 0 is a header and must not be validated as data. */
  hasHeader: boolean;
  /** 0-100. Below ~70 the caller should ask the user to confirm. */
  confidence: number;
  /** One sentence, written for the user, not for the log. */
  reason: string;
  /** The header cell we matched, when a header was there at all. */
  header: string | null;
}

/** How many data rows are worth reading before deciding. */
export const SNIFF_ROWS = 50;

/** Normalised header names that mean "this is the address". */
const EXACT_HEADERS = new Set([
  'email',
  'emails',
  'emailaddress',
  'emailaddresses',
  'emailid',
  'useremail',
  'usermail',
  'workemail',
  'personalemail',
  'primaryemail',
  'contactemail',
  'emailcontact',
  'mail',
  'mailaddress',
  'address', // only ever reached when nothing better matched
  'correo',
  'correoelectronico',
  'courriel',
  'epost',
  'eposta',
  'epostadresse',
  'mailadresse',
  'mailadres',
  'emailadres',
  'endereco',
  'enderecoeletronico',
]);

/**
 * `address` and `endereco` are in the list because plenty of exports use them
 * for the email column, but they mean a postal address at least as often — so
 * they score low and let the data decide.
 */
const WEAK_EXACT_HEADERS = new Set(['address', 'endereco']);

export function detectEmailColumn(sample: readonly (readonly string[])[]): ColumnDetection {
  const width = sample.reduce((max, row) => Math.max(max, row.length), 0);
  if (width === 0) {
    return {
      index: 0,
      hasHeader: false,
      confidence: 0,
      reason: 'File has no rows.',
      header: null,
    };
  }

  const first = sample[0] ?? [];
  // A header row never contains an address — that is the only tell that works
  // regardless of language, and it is why detection happens on the data and
  // the header together rather than on either alone.
  const firstLooksLikeData = first.some((cell) => cell.includes('@'));
  const named = firstLooksLikeData ? null : bestHeaderMatch(first);
  const dataRows = firstLooksLikeData ? sample : sample.slice(1);

  const withAt = countAddresses(dataRows, width);
  const sampled = dataRows.length;
  const best = argMax(withAt);
  const bestCount = withAt[best] ?? 0;

  // A header row we could not name is still a header, as long as something
  // below it holds addresses and it does not.
  const hasHeader = !firstLooksLikeData && (named !== null || bestCount > 0);

  if (named !== null) {
    const namedCount = withAt[named.index] ?? 0;

    // The header lies. Trust the column that actually holds addresses — but
    // only when it holds far more of them, so a list where a few people left
    // the email blank does not get thrown away over a stray `@` elsewhere.
    if (bestCount > 0 && namedCount * 2 < bestCount) {
      return {
        index: best,
        hasHeader,
        confidence: 70,
        reason:
          `Header "${named.header}" (column ${named.index + 1}) holds no addresses; ` +
          `column ${best + 1} holds "@" in ${bestCount} of ${sampled} sampled rows — using column ${best + 1}.`,
        header: named.header,
      };
    }

    if (namedCount > 0) {
      return {
        index: named.index,
        hasHeader,
        confidence: 99,
        reason:
          `Header "${named.header}" at column ${named.index + 1}, ` +
          `confirmed by ${namedCount} of ${sampled} sampled rows containing "@".`,
        header: named.header,
      };
    }

    // Nothing to confirm against — a header-only file, or one whose rows are
    // all malformed. The name is all we have.
    return {
      index: named.index,
      hasHeader: true,
      confidence: named.score,
      reason:
        `Header "${named.header}" at column ${named.index + 1}. ` +
        `No sampled row held an "@", so the choice rests on the header name alone.`,
      header: named.header,
    };
  }

  if (bestCount > 0) {
    const share = bestCount / Math.max(sampled, 1);
    return {
      index: best,
      hasHeader,
      // Capped below a named match: counting `@` is good evidence, never proof.
      confidence: Math.min(90, Math.max(20, Math.round(share * 100))),
      reason:
        `${hasHeader ? 'Header row did not name an email column' : 'No header row'}; ` +
        `column ${best + 1} holds "@" in ${bestCount} of ${sampled} sampled rows.`,
      header: hasHeader ? (first[best] ?? null) : null,
    };
  }

  return {
    index: 0,
    hasHeader: false,
    confidence: 0,
    reason: `No column holds an "@" in the first ${sampled} rows — falling back to column 1.`,
    header: null,
  };
}

interface HeaderMatch {
  index: number;
  header: string;
  score: number;
}

/** Highest-scoring header cell, leftmost on a tie. */
function bestHeaderMatch(row: readonly string[]): HeaderMatch | null {
  let match: HeaderMatch | null = null;

  for (let i = 0; i < row.length; i++) {
    const header = row[i] ?? '';
    const score = headerScore(header);
    if (score > 0 && (match === null || score > match.score)) {
      match = { index: i, header, score };
    }
  }

  return match;
}

/**
 * 0 means "not an email header". Everything above is also the confidence we
 * would report if the data never gets a chance to confirm it.
 */
function headerScore(header: string): number {
  const key = header.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (key.length === 0) return 0;

  if (EXACT_HEADERS.has(key)) return WEAK_EXACT_HEADERS.has(key) ? 70 : 95;
  if (key.includes('email')) return 85;
  // `mailing_address` and `mailinglist` reach this line; the data check below
  // is what saves us from them.
  if (key.includes('mail')) return 75;
  return 0;
}

function countAddresses(rows: readonly (readonly string[])[], width: number): number[] {
  const counts = new Array<number>(width).fill(0);

  for (const row of rows) {
    for (let i = 0; i < width; i++) {
      if ((row[i] ?? '').includes('@')) counts[i] = (counts[i] ?? 0) + 1;
    }
  }

  return counts;
}

function argMax(counts: readonly number[]): number {
  let best = 0;

  for (let i = 1; i < counts.length; i++) {
    if ((counts[i] ?? 0) > (counts[best] ?? 0)) best = i;
  }

  return best;
}
