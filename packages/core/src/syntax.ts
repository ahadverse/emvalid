import { isQuoted, type SplitAddress } from './normalize.ts';

/**
 * Feature 1 — RFC 5321/5322 syntax validation, deliberately a little stricter
 * than the RFC.
 *
 * The RFC permits things no mail server on earth will accept: comments in the
 * local part, IP-literal domains, single-label domains. Accepting those would
 * be technically correct and practically useless — every one of them bounces.
 * Where we are stricter than the spec, the reason says so, so nobody has to
 * guess why their address was rejected.
 */

export type SyntaxFailure =
  | 'empty'
  | 'no_at'
  | 'local_empty'
  | 'local_too_long'
  | 'local_bad_char'
  | 'local_dot_position'
  | 'local_unterminated_quote'
  | 'domain_empty'
  | 'domain_too_long'
  | 'domain_single_label'
  | 'domain_label_empty'
  | 'domain_label_too_long'
  | 'domain_bad_char'
  | 'domain_hyphen_position'
  | 'domain_ip_literal'
  | 'domain_bad_tld'
  | 'address_too_long';

export interface SyntaxOk {
  ok: true;
}
export interface SyntaxBad {
  ok: false;
  failure: SyntaxFailure;
  detail: string;
}
export type SyntaxVerdict = SyntaxOk | SyntaxBad;

/** RFC 5322 atext — the unquoted local part alphabet. */
const ATEXT = /^[A-Za-z0-9!#$%&'*+\-/=?^_`{|}~]+$/;
const DOMAIN_LABEL = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
/** A real TLD is alphabetic, or punycode for a non-ASCII one. */
const TLD = /^(?:[a-z]{2,63}|xn--[a-z0-9-]{2,59})$/;

const MAX_LOCAL = 64; // RFC 5321 §4.5.3.1.1, octets
const MAX_DOMAIN = 253;
const MAX_ADDRESS = 254; // 256 minus the <> a server wraps it in

const FAILURE_DETAIL: Record<SyntaxFailure, string> = {
  empty: 'Address is empty.',
  no_at: 'No @ sign — this is not an email address.',
  local_empty: 'Nothing before the @.',
  local_too_long: `Part before @ is over ${MAX_LOCAL} characters.`,
  local_bad_char: 'Part before @ contains a character that is not allowed.',
  local_dot_position: 'Part before @ starts, ends, or doubles a dot.',
  local_unterminated_quote: 'Quoted name before @ is not closed.',
  domain_empty: 'Nothing after the @.',
  domain_too_long: `Domain is over ${MAX_DOMAIN} characters.`,
  domain_single_label: 'Domain has no dot — a public mail domain always has one.',
  domain_label_empty: 'Domain has an empty part (two dots in a row, or a leading dot).',
  domain_label_too_long: 'A domain part is over 63 characters.',
  domain_bad_char: 'Domain contains a character that is not allowed.',
  domain_hyphen_position: 'A domain part starts or ends with a hyphen.',
  domain_ip_literal: 'Domain is a bare IP address — real mailboxes do not use these.',
  domain_bad_tld: 'Domain ending is not a valid top-level domain.',
  address_too_long: `Address is over ${MAX_ADDRESS} characters.`,
};

export function checkSyntax(parts: SplitAddress): SyntaxVerdict {
  const local = checkLocalPart(parts.localPart);
  if (!local.ok) return local;

  const domain = checkDomain(parts.domain);
  if (!domain.ok) return domain;

  // Byte length, not character count — an IDN local part can be short on
  // screen and over the limit on the wire.
  const octets = Buffer.byteLength(`${parts.localPart}@${parts.domain}`, 'utf8');
  if (octets > MAX_ADDRESS) return bad('address_too_long');

  return { ok: true };
}

function checkLocalPart(local: string): SyntaxVerdict {
  if (local.length === 0) return bad('local_empty');
  if (Buffer.byteLength(local, 'utf8') > MAX_LOCAL) return bad('local_too_long');

  if (local.startsWith('"')) {
    return isQuoted(local) && isValidQuotedString(local)
      ? { ok: true }
      : bad('local_unterminated_quote');
  }

  if (local.startsWith('.') || local.endsWith('.') || local.includes('..')) {
    return bad('local_dot_position');
  }

  for (const atom of local.split('.')) {
    if (!ATEXT.test(atom)) return bad('local_bad_char');
  }

  return { ok: true };
}

function checkDomain(domain: string): SyntaxVerdict {
  if (domain.length === 0) return bad('domain_empty');
  if (domain.startsWith('[') || /^\d{1,3}(\.\d{1,3}){3}$/.test(domain)) {
    return bad('domain_ip_literal');
  }
  if (domain.length > MAX_DOMAIN) return bad('domain_too_long');

  const labels = domain.split('.');
  if (labels.length < 2) return bad('domain_single_label');

  for (const label of labels) {
    if (label.length === 0) return bad('domain_label_empty');
    if (label.length > 63) return bad('domain_label_too_long');
    if (label.startsWith('-') || label.endsWith('-')) return bad('domain_hyphen_position');
    if (!DOMAIN_LABEL.test(label)) return bad('domain_bad_char');
  }

  const tld = labels[labels.length - 1] ?? '';
  if (!TLD.test(tld)) return bad('domain_bad_tld');

  return { ok: true };
}

/** Inside quotes anything printable goes, as long as `"` and `\` are escaped. */
function isValidQuotedString(local: string): boolean {
  const inner = local.slice(1, -1);
  let escaped = false;

  for (const ch of inner) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch === '"') return false;
    const code = ch.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return false;
  }

  return !escaped;
}

function bad(failure: SyntaxFailure): SyntaxBad {
  return { ok: false, failure, detail: FAILURE_DETAIL[failure] };
}
