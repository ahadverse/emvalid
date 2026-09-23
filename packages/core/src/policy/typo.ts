import { freeProviderDomains } from './free-providers.ts';

/**
 * Feature 11 — typo detection and suggestion. ~85%.
 *
 * Two failure modes, and they are not symmetric. Missing a typo costs one
 * bounce. Suggesting a "correction" for a domain that was right all along
 * makes a user delete a good address — much worse. So the thresholds lean
 * conservative: a suggestion has to be close, and the domain has to not be a
 * real one we already know about.
 */

/** Consumer domains people mistype, plus the ones typo-squatters target. */
const POPULAR_DOMAINS: readonly string[] = [
  'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.uk', 'yahoo.co.in',
  'hotmail.com', 'hotmail.co.uk', 'outlook.com', 'live.com', 'msn.com',
  'icloud.com', 'me.com', 'aol.com', 'protonmail.com', 'proton.me',
  'zoho.com', 'yandex.ru', 'mail.ru', 'gmx.com', 'gmx.de', 'web.de',
  'mail.com', 'fastmail.com', 'qq.com', '163.com', 'naver.com',
  'comcast.net', 'verizon.net', 'att.net', 'sbcglobal.net', 'cox.net',
  'btinternet.com', 'orange.fr', 'free.fr', 'libero.it', 't-online.de',
  'rediffmail.com', 'bigpond.com',
];

/** Valid endings, so we can tell a bad TLD from an unknown-but-fine one. */
const COMMON_TLDS: readonly string[] = [
  'com', 'net', 'org', 'edu', 'gov', 'mil', 'int', 'info', 'biz', 'io',
  'co', 'uk', 'us', 'ca', 'de', 'fr', 'it', 'es', 'nl', 'be', 'ch', 'at',
  'se', 'no', 'dk', 'fi', 'pl', 'ru', 'ua', 'in', 'pk', 'bd', 'lk', 'np',
  'cn', 'jp', 'kr', 'sg', 'my', 'id', 'th', 'vn', 'ph', 'au', 'nz',
  'br', 'mx', 'ar', 'cl', 'co.uk', 'com.au', 'co.in', 'com.br', 'com.bd',
  'za', 'ng', 'ke', 'eg', 'ae', 'sa', 'tr', 'ir', 'il', 'app', 'dev',
  'me', 'tv', 'cc', 'ai', 'xyz', 'online', 'site', 'store', 'tech', 'shop',
];

/** Straight substitutions — no distance metric catches `.con` reliably. */
const TLD_FIXES = new Map([
  ['con', 'com'], ['cpm', 'com'], ['ocm', 'com'], ['cim', 'com'],
  ['comm', 'com'], ['comn', 'com'], ['cmo', 'com'], ['xom', 'com'],
  ['vom', 'com'], ['dom', 'com'], ['som', 'com'], ['co,', 'com'],
  ['cm', 'com'], ['om', 'com'], ['coom', 'com'], ['comme', 'com'],
  ['nte', 'net'], ['nrt', 'net'], ['ner', 'net'], ['met', 'net'],
  ['ogr', 'org'], ['orgg', 'org'], ['prg', 'org'], ['or', 'org'],
]);

export interface TypoSuggestion {
  /** The domain we think they meant. */
  domain: string;
  /** 0-1. How confident, used to decide whether to surface it at all. */
  score: number;
}

/**
 * Returns null when the domain looks fine, or when nothing close enough was
 * found. `knownGood` lets the platform pass in domains it has already seen
 * resolve — a customer's own domain should never be "corrected".
 */
export function suggestDomain(
  domain: string,
  knownGood: ReadonlySet<string> = freeProviderDomains(),
): TypoSuggestion | null {
  const value = domain.toLowerCase();

  // A domain we know is real is never a typo, whatever it looks like.
  if (knownGood.has(value) || POPULAR_DOMAINS.includes(value)) return null;

  const tldFix = fixTld(value);
  if (tldFix !== null) return { domain: tldFix, score: 0.95 };

  let best: TypoSuggestion | null = null;

  for (const candidate of POPULAR_DOMAINS) {
    // Length gap alone rules most pairs out before we do any real work.
    if (Math.abs(candidate.length - value.length) > 2) continue;

    const distance = damerauLevenshtein(value, candidate, 2);
    if (distance === null || distance === 0) continue;

    const limit = candidate.length >= 10 ? 2 : 1;
    if (distance > limit) continue;

    const score = 1 - distance / Math.max(value.length, candidate.length);
    if (best === null || score > best.score) best = { domain: candidate, score };
  }

  // Below this the "correction" is a guess, and a wrong guess costs a real
  // address.
  return best !== null && best.score >= 0.75 ? best : null;
}

/**
 * `gmail.con` → `gmail.com`. Only fires when the part before the TLD is
 * already a domain we recognise, so `mycompany.con` is left alone — it might
 * genuinely be a weird TLD, and we have no business rewriting it.
 */
function fixTld(domain: string): string | null {
  const lastDot = domain.lastIndexOf('.');
  if (lastDot <= 0) return null;

  const stem = domain.slice(0, lastDot);
  const tld = domain.slice(lastDot + 1);

  if (COMMON_TLDS.includes(tld)) return null;

  const fixed = TLD_FIXES.get(tld);
  if (fixed === undefined) return null;

  const candidate = `${stem}.${fixed}`;
  return POPULAR_DOMAINS.includes(candidate) ? candidate : null;
}

/**
 * Damerau-Levenshtein with adjacent transposition — `gmial.com` is one
 * mistake by this metric, two by plain Levenshtein, and it is by far the most
 * common way people misspell a domain.
 *
 * Returns null as soon as the distance provably exceeds `max`, which keeps
 * the scan over the candidate list cheap.
 */
export function damerauLevenshtein(a: string, b: string, max = Infinity): number | null {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return null;

  // Two rows back is all a transposition needs.
  let prev2: number[] = [];
  let prev: number[] = Array.from({ length: b.length + 1 }, (_, i) => i);
  let current: number[] = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i++) {
    current[0] = i;
    let rowMin = i;

    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min(
        (current[j - 1] ?? 0) + 1, // insertion
        (prev[j] ?? 0) + 1, // deletion
        (prev[j - 1] ?? 0) + cost, // substitution
      );

      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        value = Math.min(value, (prev2[j - 2] ?? 0) + 1); // transposition
      }

      current[j] = value;
      if (value < rowMin) rowMin = value;
    }

    // Every later row is >= this row's minimum, so we can stop early.
    if (rowMin > max) return null;

    prev2 = prev;
    prev = current;
    current = new Array<number>(b.length + 1);
  }

  const distance = prev[b.length] ?? Infinity;
  return distance > max ? null : distance;
}
