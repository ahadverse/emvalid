/**
 * Feature 64 — provider-specific username rules. Gmail only.
 *
 * A syntactically valid local part can still be a username Gmail itself would
 * never let anyone register — too short, too long, a character Gmail does not
 * allow, a leading/trailing/doubled dot. Gmail publishes these rules at
 * signup, so an address that breaks them is undeliverable with high
 * confidence, and we can say so before DNS even runs.
 *
 * Scoped to `gmail.com` and `googlemail.com` by exact domain match only.
 * That is also what keeps this safe for Google Workspace: a custom domain
 * routed through Google never matches either name, so this check simply never
 * fires there — Workspace usernames follow the admin's own rules, not
 * consumer Gmail's, and applying consumer rules to them would delete good
 * addresses.
 *
 * Yahoo and Outlook are deliberately not covered: both still allow legacy
 * account names created under older, looser rules, so a modern rule set would
 * flag real inboxes as invalid.
 */

export type ProviderRuleFailure =
  | 'too_short'
  | 'too_long'
  | 'invalid_character'
  | 'must_start_with_letter'
  | 'leading_or_trailing_dot'
  | 'consecutive_dots';

export interface ProviderRuleViolation {
  provider: 'gmail';
  failure: ProviderRuleFailure;
  detail: string;
}

const GMAIL_DOMAINS = new Set(['gmail.com', 'googlemail.com']);

const MIN_LENGTH = 6;
const MAX_LENGTH = 30;

/** Letters, digits and dots only — Gmail's own signup charset. */
const CHARSET = /^[a-z0-9.]+$/;

const FAILURE_DETAIL: Record<ProviderRuleFailure, string> = {
  too_short: `Gmail usernames must be at least ${MIN_LENGTH} characters.`,
  too_long: `Gmail usernames must be ${MAX_LENGTH} characters or fewer.`,
  invalid_character: 'Gmail usernames may only contain letters, numbers and dots.',
  must_start_with_letter: 'Gmail usernames must start with a letter.',
  leading_or_trailing_dot: 'Gmail usernames cannot start or end with a dot.',
  consecutive_dots: 'Gmail usernames cannot contain two dots in a row.',
};

/** Whether this domain is one the rules below apply to at all. */
export function isGmailDomain(domain: string): boolean {
  return GMAIL_DOMAINS.has(domain.toLowerCase());
}

/**
 * `null` means either the domain is not Gmail (rule does not apply) or the
 * username is fine. Only the base username is checked — anything from the
 * first `+` onward is a tag Gmail does not apply this charset to.
 */
export function checkProviderUsernameRules(
  domain: string,
  localPart: string,
): ProviderRuleViolation | null {
  if (!isGmailDomain(domain)) return null;

  const plus = localPart.indexOf('+');
  const base = (plus === -1 ? localPart : localPart.slice(0, plus)).toLowerCase();

  if (base.startsWith('.') || base.endsWith('.')) return violation('leading_or_trailing_dot');
  if (base.includes('..')) return violation('consecutive_dots');
  if (!CHARSET.test(base)) return violation('invalid_character');
  if (base.length < MIN_LENGTH) return violation('too_short');
  if (base.length > MAX_LENGTH) return violation('too_long');
  if (!/^[a-z]/.test(base)) return violation('must_start_with_letter');

  return null;
}

function violation(failure: ProviderRuleFailure): ProviderRuleViolation {
  return { provider: 'gmail', failure, detail: FAILURE_DETAIL[failure] };
}
