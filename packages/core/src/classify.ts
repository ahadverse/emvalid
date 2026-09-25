import { canonicalize, normalizeAddress, splitAddress, type SplitAddress } from './normalize.ts';
import { checkSyntax, type SyntaxBad } from './syntax.ts';
import { isDisposable } from './policy/disposable.ts';
import { isFreeProvider } from './policy/free-providers.ts';
import { isRoleAccount } from './policy/role.ts';
import { checkProviderUsernameRules, type ProviderRuleViolation } from './policy/provider-rules.ts';
import { suggestDomain } from './policy/typo.ts';
import type { Advice, DomainInfo, EmailResult, ReasonCode, Status } from './types.ts';

/**
 * Feature 13 — turn the raw signals into one verdict.
 *
 * The rule this file refuses to break: without SMTP we never say
 * `deliverable`. Not for gmail.com, not for a domain with perfect DNS. MX
 * records prove a server exists, they say nothing about whether the mailbox
 * does. Roughly 75% of any real list will come back `unknown`, and that
 * number is the honest one — a tool that returns 90% "valid" here is quietly
 * printing `unknown` with a nicer word on it.
 *
 * `confidence` means: how sure are we that `status` is right. For `unknown`
 * it reads differently and is documented at the point it is set.
 */

/** Everything derivable from the string alone — no network, no I/O. */
export interface ParsedEmail {
  input: string;
  parts: SplitAddress | null;
  normalized: string | null;
  canonical: string | null;
  syntaxError: SyntaxBad | null;
  role: boolean;
  disposable: boolean;
  freeProvider: boolean;
  alias: boolean;
  suggestion: string | null;
  /** Feature 64 — set only for gmail.com/googlemail.com, null everywhere else. */
  providerRuleViolation: ProviderRuleViolation | null;
}

/**
 * Phase one, synchronous. Bulk jobs run this over every row first, then group
 * the survivors by domain so DNS runs once per domain instead of once per
 * address.
 */
export function parseEmail(input: string): ParsedEmail {
  const parts = splitAddress(input);

  if (parts === null) {
    return {
      input,
      parts: null,
      normalized: null,
      canonical: null,
      syntaxError: {
        ok: false,
        failure: input.includes('@') ? 'local_empty' : 'no_at',
        detail: input.trim().length === 0
          ? 'Address is empty.'
          : 'No @ sign — this is not an email address.',
      },
      role: false,
      disposable: false,
      freeProvider: false,
      alias: false,
      suggestion: null,
      providerRuleViolation: null,
    };
  }

  const syntax = checkSyntax(parts);
  const normalized = normalizeAddress(parts);
  const canonical = canonicalize(parts);

  if (!syntax.ok) {
    return {
      input,
      parts,
      normalized,
      canonical,
      syntaxError: syntax,
      role: false,
      disposable: false,
      freeProvider: false,
      alias: false,
      suggestion: null,
      providerRuleViolation: null,
    };
  }

  const suggestion = suggestDomain(parts.domain);

  return {
    input,
    parts,
    normalized,
    canonical,
    syntaxError: null,
    role: isRoleAccount(parts.localPart),
    disposable: isDisposable(parts.domain),
    freeProvider: isFreeProvider(parts.domain),
    alias: canonical !== normalized,
    suggestion:
      suggestion === null
        ? null
        : `${parts.localPart.toLowerCase()}@${suggestion.domain}`,
    providerRuleViolation: checkProviderUsernameRules(parts.domain, parts.localPart),
  };
}

/**
 * Phase two. `domain` is null when DNS has not run — the result then stops at
 * whatever the string alone could prove.
 */
export function classify(parsed: ParsedEmail, domain: DomainInfo | null): EmailResult {
  const base = {
    input: parsed.input,
    normalized: parsed.normalized,
    canonical: parsed.canonical,
    localPart: parsed.parts?.localPart ?? null,
    domain: parsed.parts?.domain ?? null,
    domainUnicode: parsed.parts?.idn === true ? parsed.parts.domainUnicode : null,
    suggestion: parsed.suggestion,
    flags: {
      role: parsed.role,
      disposable: parsed.disposable,
      freeProvider: parsed.freeProvider,
      idn: parsed.parts?.idn ?? false,
      alias: parsed.alias,
      mxProvider: domain?.provider ?? null,
    },
  };

  const verdict = decide(parsed, domain);
  return { ...base, ...verdict };
}

interface Verdict {
  status: Status;
  advice: Advice;
  confidence: number;
  reason: ReasonCode;
  detail: string;
  retryable: boolean;
}

function decide(parsed: ParsedEmail, domain: DomainInfo | null): Verdict {
  // 1. Syntax. Cheapest check and the only one that is free of doubt — a
  //    malformed address cannot be delivered to by definition.
  if (parsed.syntaxError !== null) {
    return {
      status: 'undeliverable',
      advice: 'do_not_send',
      confidence: 100,
      reason: 'syntax_invalid',
      detail: parsed.syntaxError.detail,
      retryable: false,
    };
  }

  // 2. Feature 64 — a username Gmail itself would reject. Cheap, string-only,
  //    and undeliverable regardless of what DNS says, so it runs before DNS
  //    trouble gets a chance to mask it behind a retry.
  if (parsed.providerRuleViolation !== null) {
    return {
      status: 'undeliverable',
      advice: 'do_not_send',
      confidence: 98,
      reason: 'provider_rules_invalid',
      detail: parsed.providerRuleViolation.detail,
      retryable: false,
    };
  }

  // 3. DNS trouble outranks every domain-level verdict below, because those
  //    verdicts are all read off DNS data we do not have. Feature 7 lives or
  //    dies here: this must never fall through to "no mail server".
  if (domain?.error != null) {
    const timeout = domain.error === 'timeout';
    return {
      status: 'unknown',
      advice: 'retry',
      confidence: 0,
      reason: timeout ? 'dns_timeout' : 'dns_error',
      detail: timeout
        ? 'DNS lookup timed out — the domain was not checked. Retry pending.'
        : 'DNS lookup failed — the domain was not checked. Retry pending.',
      retryable: true,
    };
  }

  if (domain !== null) {
    // 4. The domain itself does not exist. Nothing sent here can arrive.
    if (domain.nxdomain) {
      return {
        status: 'undeliverable',
        advice: 'do_not_send',
        confidence: 99,
        reason: 'domain_not_found',
        detail: 'Domain does not exist.',
        retryable: false,
      };
    }

    // 5. RFC 7505 null MX — the domain states outright that it takes no mail.
    if (domain.nullMx) {
      return {
        status: 'undeliverable',
        advice: 'do_not_send',
        confidence: 99,
        reason: 'domain_null_mx',
        detail: 'Domain publishes a null MX — it accepts no mail at all.',
        retryable: false,
      };
    }

    // 6. Domain resolves, but there is nowhere to deliver: no MX and no
    //    address record to fall back on.
    if (domain.mx.length === 0 && !domain.hasAddressRecord) {
      return {
        status: 'undeliverable',
        advice: 'do_not_send',
        confidence: 97,
        reason: 'domain_no_mail_server',
        detail: 'Domain has no mail server (no MX and no A record).',
        retryable: false,
      };
    }
  }

  // 7. Burner address. Deliverable today, gone next week, and it belongs to
  //    nobody — the strongest risky signal we have.
  if (parsed.disposable) {
    return {
      status: 'risky',
      advice: 'do_not_send',
      confidence: 90,
      reason: 'disposable_domain',
      detail: 'Disposable/temporary mail provider — the address will stop working.',
      retryable: false,
    };
  }

  // 8. Looks like a mistyped domain. Ranked above role because if the domain
  //    is wrong, nothing else about the address matters.
  if (parsed.suggestion !== null) {
    return {
      status: 'risky',
      // Not `do_not_send`: we might be wrong about the typo, and the fix is
      // usually one keystroke. That is a decision for a person, not for us.
      advice: 'review',
      confidence: 80,
      reason: 'typo_suspected',
      detail: `Domain looks misspelled — did they mean ${parsed.suggestion}?`,
      retryable: false,
    };
  }

  // 9. Shared or automated inbox. Usually deliverable, always a bad send.
  if (parsed.role) {
    return {
      status: 'risky',
      // Perfectly deliverable, and for a support or sales campaign it may be
      // exactly the address wanted. Only the sender knows.
      advice: 'review',
      confidence: 95,
      reason: 'role_account',
      detail: 'Role address (shared or automated inbox), not a person.',
      retryable: false,
    };
  }

  // 10. Everything checks out and we still do not know if the mailbox exists.
  //    For `unknown`, confidence reads as "how likely mail would be accepted"
  //    — a prior from the domain evidence, not a claim about the mailbox.
  if (domain === null) {
    return {
      status: 'unknown',
      advice: 'retry',
      confidence: 30,
      reason: 'mailbox_unverified',
      detail: 'Syntax is valid. Domain not checked.',
      retryable: true,
    };
  }

  if (domain.mx.length > 0) {
    return {
      status: 'unknown',
      // The whole point of the split. Every check we can run came back clean,
      // so the recommendation is send — while `status` keeps saying we never
      // proved the mailbox, which remains true and is what the API reports.
      advice: 'send',
      confidence: 50,
      reason: 'mailbox_unverified',
      // Customer-facing text, and it lands in the downloaded CSV. It says what
      // we did and did not establish, in plain words — no internal feature
      // names, which only point at something they cannot buy.
      detail: 'Domain accepts mail. This specific mailbox could not be confirmed.',
      retryable: false,
    };
  }

  // A-record fallback only — legal, and weaker evidence than a real MX.
  return {
    status: 'unknown',
    advice: 'send',
    confidence: 40,
    reason: 'mailbox_unverified',
    detail: 'Domain has no MX but resolves; mail may be accepted. Mailbox not confirmed.',
    retryable: false,
  };
}
