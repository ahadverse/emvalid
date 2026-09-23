import { domainToASCII, domainToUnicode } from 'node:url';

/**
 * Features 1-3: trim, lowercase, IDN → punycode, and provider-aware alias
 * collapsing.
 *
 * Two different outputs come out of here and they must not be confused:
 *
 *   normalized — what we validate and what we show the user back.
 *                `John.Doe+news@Gmail.com` → `john.doe+news@gmail.com`
 *   canonical  — which mailbox this actually is, used only for dedupe.
 *                `John.Doe+news@Gmail.com` → `johndoe@gmail.com`
 *
 * We never hand `canonical` back as the address to mail. It exists to answer
 * "are these two rows the same person" and nothing else.
 */

export interface SplitAddress {
  localPart: string;
  /** Punycode/ASCII form. */
  domain: string;
  /** Unicode form, differs from `domain` only for IDN. */
  domainUnicode: string;
  idn: boolean;
}

/** Providers that ignore everything after `+` in the local part. */
const PLUS_TAG_PROVIDERS = new Set([
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'msn.com',
  'icloud.com',
  'me.com',
  'mac.com',
  'fastmail.com',
  'protonmail.com',
  'proton.me',
  'pm.me',
  'yandex.ru',
  'yandex.com',
  'zoho.com',
  'tutanota.com',
  'hey.com',
]);

/** Providers that also ignore dots in the local part. Gmail is the big one. */
const DOT_INSENSITIVE_PROVIDERS = new Set(['gmail.com', 'googlemail.com']);

/** Domains that are the same mailbox under a different name. */
const DOMAIN_ALIASES = new Map([
  ['googlemail.com', 'gmail.com'],
  ['ymail.com', 'yahoo.com'],
  ['rocketmail.com', 'yahoo.com'],
  ['hotmail.co.uk', 'hotmail.com'],
  ['live.co.uk', 'live.com'],
]);

/**
 * Split a raw string into local part and domain.
 *
 * Returns null when the shape is hopeless — no `@`, or a quoted local part
 * that never closes. Everything else is left for the syntax checker to judge;
 * this function only takes the string apart.
 */
export function splitAddress(raw: string): SplitAddress | null {
  const trimmed = stripAngleBrackets(raw.trim());
  if (trimmed.length === 0) return null;

  const at = lastUnquotedAt(trimmed);
  if (at <= 0 || at === trimmed.length - 1) return null;

  const localPart = trimmed.slice(0, at);
  const rawDomain = trimmed.slice(at + 1).replace(/\.+$/, ''); // drop FQDN trailing dot
  if (rawDomain.length === 0) return null;

  // domainToASCII lowercases, strips the trailing dot and applies UTS-46.
  // It returns '' for anything it cannot map — including domains that only
  // look broken to it, so a failure here is not yet a verdict.
  const ascii = domainToASCII(rawDomain);
  const domain = ascii === '' ? rawDomain.toLowerCase() : ascii;
  const domainUnicode = ascii === '' ? domain : domainToUnicode(ascii);

  return {
    localPart,
    domain,
    domainUnicode,
    idn: domainUnicode !== domain,
  };
}

/**
 * Feature 1-2. Lowercases the local part too: RFC 5321 says it is
 * case-sensitive, but no mail provider in real use treats it that way, and
 * keeping the case would split one mailbox across two rows during dedupe.
 * Quoted local parts keep their case — there the RFC actually bites.
 */
export function normalizeAddress(parts: SplitAddress): string {
  const local = isQuoted(parts.localPart)
    ? parts.localPart
    : parts.localPart.toLowerCase();
  return `${local}@${parts.domain}`;
}

/**
 * Features 3-4. Collapse an address down to the mailbox it really points at,
 * so `j.doe+shop@googlemail.com` and `jdoe@gmail.com` dedupe to one row.
 *
 * Only applied to providers we know behave this way. Doing it blindly would
 * merge two different people on a custom domain — some servers really do
 * deliver `a.b@` and `ab@` to separate mailboxes.
 */
export function canonicalize(parts: SplitAddress): string {
  const domain = DOMAIN_ALIASES.get(parts.domain) ?? parts.domain;

  if (isQuoted(parts.localPart)) return `${parts.localPart}@${domain}`;

  let local = parts.localPart.toLowerCase();

  if (PLUS_TAG_PROVIDERS.has(parts.domain)) {
    const plus = local.indexOf('+');
    if (plus > 0) local = local.slice(0, plus);
  }

  if (DOT_INSENSITIVE_PROVIDERS.has(parts.domain)) {
    local = local.replaceAll('.', '');
  }

  return `${local}@${domain}`;
}

/** `Ahad <ahad@x.com>` → `ahad@x.com`. CSV exports are full of these. */
function stripAngleBrackets(value: string): string {
  const open = value.lastIndexOf('<');
  const close = value.lastIndexOf('>');
  if (open !== -1 && close > open) return value.slice(open + 1, close).trim();
  return value;
}

/**
 * The last `@` that is not inside a quoted local part. `"a@b"@c.com` is a
 * legal address whose domain is `c.com`, so a naive split on the first `@`
 * gets it wrong.
 *
 * When a quote is opened and never closed, every `@` after it looks quoted
 * and we would find none. Rather than refuse to split — which would report
 * "no @ sign" for a string that plainly has one — fall back to the last `@`
 * so the syntax checker can name the real problem.
 */
function lastUnquotedAt(value: string): number {
  let inQuotes = false;
  let escaped = false;
  let index = -1;
  let lastAny = -1;

  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (ch === '@') {
      lastAny = i;
      if (!inQuotes) index = i;
    }
  }

  return index === -1 ? lastAny : index;
}

export function isQuoted(localPart: string): boolean {
  return localPart.length >= 2 && localPart.startsWith('"') && localPart.endsWith('"');
}
