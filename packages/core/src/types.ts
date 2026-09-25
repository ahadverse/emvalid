/**
 * Result model — feature 13.
 *
 * The whole product rests on one rule: never answer with a bare valid/invalid.
 * Every result carries three things — what we decided (`status`), how sure we
 * are (`confidence`), and why (`reason`). A caller that only reads `status`
 * still gets an honest answer; one that reads all three can build its own policy.
 */

export type Status =
  /** Mailbox confirmed to accept mail. Only SMTP (Deep Scan) can prove this. */
  | 'deliverable'
  /** Provably cannot receive mail. Safe to drop from any list. */
  | 'undeliverable'
  /** Deliverable in principle, but sending here is a bad idea. */
  | 'risky'
  /** We could not find out. The honest default without SMTP. */
  | 'unknown';

/**
 * What the customer should actually do with this address.
 *
 * `status` answers "what did we establish", which is the technically correct
 * question and the wrong one to lead with. A user cleaning a list is not
 * asking whether a mailbox provably exists; they are asking whether to press
 * send. Leading with `unknown` on an address where every check passed reads as
 * "we found nothing" when the truth is "we found nothing wrong" — and those
 * are opposite messages.
 *
 * So this is a recommendation, not a claim. `send` never asserts the mailbox
 * exists; it says nothing about this address gives us a reason to hold it
 * back, which is exactly what a list cleaner is for. The two fields stay
 * separate on purpose: collapsing them would mean either lying in `status` or
 * being useless in the UI.
 */
export type Advice =
  /** Nothing wrong found. Keep it in the list. */
  | 'send'
  /** Deliverable, probably, but a bad idea. A human should look. */
  | 'review'
  /** Provably dead. Remove it. */
  | 'do_not_send'
  /** We were prevented from checking. Ask again; this is not a verdict. */
  | 'retry';

export type ReasonCode =
  // --- undeliverable (certain) ---
  | 'syntax_invalid'
  // Feature 64. Not merged with `syntax_invalid`'s 100% — this is a provider
  // policy read off a publicly documented rule, not the address format itself.
  | 'provider_rules_invalid'
  | 'domain_not_found'
  | 'domain_no_mail_server'
  | 'domain_null_mx'
  // --- risky ---
  | 'disposable_domain'
  | 'role_account'
  | 'typo_suspected'
  | 'domain_too_new'
  // Feature 66. Split in two because the advice differs: no MX at all is a
  // plain "don't bother", an MX on a parked domain means forwarding is set
  // up somewhere and a human should look before writing the address off.
  | 'domain_parked'
  | 'domain_parked_forwarding'
  // --- unknown ---
  | 'mailbox_unverified'
  | 'mailbox_verified'
  | 'dns_timeout'
  | 'dns_error'
  // --- SMTP only (Deep Scan / a hybrid fallback like lib/verifalia.ts) ---
  | 'mailbox_exists'
  | 'mailbox_not_found';

/**
 * Which mail platform runs the domain — feature 12. Useful for two things:
 * per-provider SMTP strategy later, and telling a user "your list is 60%
 * Google Workspace" in the summary.
 */
export type MxProvider =
  | 'google'
  | 'microsoft'
  | 'yahoo'
  | 'zoho'
  | 'yandex'
  | 'proton'
  | 'icloud'
  | 'fastmail'
  | 'mailru'
  | 'amazon-ses'
  | 'mimecast'
  | 'proofpoint'
  | 'barracuda'
  | 'cpanel'
  | 'plesk'
  | 'other';

export interface EmailFlags {
  /** admin@, info@, support@ — a person does not read these. Feature 9. */
  role: boolean;
  /** Temp-mail / burner domain. Feature 8. */
  disposable: boolean;
  /** gmail.com, yahoo.com — consumer mailbox, not a company. Feature 10. */
  freeProvider: boolean;
  /** Domain held a non-ASCII label before punycode conversion. */
  idn: boolean;
  /** Input differed from its canonical form (gmail dots, +tag). Feature 3. */
  alias: boolean;
  /** Feature 12 — null until DNS runs. */
  mxProvider: MxProvider | null;
}

export interface EmailResult {
  /** Exactly what the caller passed in, untouched. */
  input: string;
  /** Trimmed, lowercased, punycode domain. Null when syntax failed. */
  normalized: string | null;
  /** Alias-collapsed form. Two rows with the same canonical are one mailbox. */
  canonical: string | null;
  localPart: string | null;
  /** ASCII (punycode) domain. */
  domain: string | null;
  /** Original Unicode domain, when it differed from `domain`. */
  domainUnicode: string | null;

  /** What we established. The technically precise answer. */
  status: Status;
  /** What to do about it. The answer a user is actually asking for. */
  advice: Advice;
  /** 0-100. How much we would bet on `status` being right. */
  confidence: number;
  reason: ReasonCode;
  /** One human sentence. Goes straight into the CSV so users stop asking us. */
  detail: string;
  /**
   * True when the answer may change on a retry — DNS failures only.
   * A job should re-run these before reporting, never count them as final.
   * Feature 7.
   */
  retryable: boolean;
  /** Feature 11 — the address we think they meant. */
  suggestion: string | null;

  flags: EmailFlags;
}

/** DNS facts about a domain, cached and shared across every address on it. */
export interface DomainInfo {
  domain: string;
  /** Sorted by priority. Empty when the domain takes no mail. */
  mx: string[];
  /** RFC 7505 null MX — the domain says "I accept no mail at all". */
  nullMx: boolean;
  /** Feature 6 — an A/AAAA record makes the domain an implicit mail target. */
  hasAddressRecord: boolean;
  /** The domain itself does not resolve. */
  nxdomain: boolean;
  /** Feature 7 — resolver broke; this is not an answer about the domain. */
  error: 'timeout' | 'servfail' | 'other' | null;
  provider: MxProvider | null;
  /**
   * Feature 66 — nameservers belong to a known parking service. `null` means
   * this was never established: either the NS lookup itself failed (kept
   * separate from `error` on purpose, per invariant 2 — a failed bonus query
   * must not turn a good MX/A answer into a retry) or, for a row read back
   * from an older cache, the column simply did not exist yet. Either way,
   * `null` is "not checked", never "not parked".
   */
  parked: boolean | null;
  /** Unix ms. Used for cache TTL. */
  checkedAt: number;
}
