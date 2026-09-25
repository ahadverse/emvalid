import type { ParsedEmail } from './classify.ts';
import { isQuoted } from './normalize.ts';
import { isDisposableMx } from './policy/disposable.ts';
import { isGmailDomain } from './policy/provider-rules.ts';
import type { DomainInfo } from './types.ts';

/**
 * The audit trail — every check the engine ran, in the order it ran them.
 *
 * `EmailResult` answers "what is the verdict". This answers "what did you
 * actually do to get there", and they are different products. A verdict alone
 * asks to be trusted; a list of named checks with their findings can be
 * argued with, which is what someone comparing us against a paid tool is
 * looking for.
 *
 * Deliberately NOT part of `EmailResult`. A bulk job writes one row per
 * address and nobody wants nine sub-findings glued onto ten million CSV rows —
 * this is built on demand, for the one-address view and the API caller who
 * asks for it.
 *
 * The rule from classify.ts carries over unchanged: a check we did not run is
 * reported as not run. Padding the list with green ticks for work we skipped
 * would make the report longer and the product a liar.
 */

export type CheckOutcome =
  /** Ran, and found nothing wrong. */
  | 'pass'
  /** Ran, and found something the sender should weigh. */
  | 'warn'
  /** Ran, and this is why the address is undeliverable. */
  | 'fail'
  /** Ran; the finding is a fact about the address, not good or bad news. */
  | 'info'
  /** Did not run, and the report says why. */
  | 'skipped';

export interface CheckFact {
  label: string;
  value: string;
  /** Identifiers, hostnames, addresses — render in the mono face. */
  mono?: boolean;
}

export type CheckId =
  | 'syntax'
  | 'normalization'
  | 'provider_rules'
  | 'typo'
  | 'role'
  | 'disposable'
  | 'free_provider'
  | 'dns'
  | 'parking'
  | 'mx_provider'
  | 'mailbox';

export interface Check {
  id: CheckId;
  /** What was examined, named the way the report names it. */
  title: string;
  outcome: CheckOutcome;
  /** One sentence: what this check found. Customer-facing prose. */
  detail: string;
  /** The evidence behind `detail`. Empty when the sentence is the whole story. */
  facts: CheckFact[];
  /** Evidence that is a list rather than a value — MX hostnames, mostly. */
  items?: string[];
}

/** Reused for every policy check that cannot run on a malformed address. */
const SYNTAX_BLOCKED = 'Not run — the address failed syntax validation.';

export function explain(parsed: ParsedEmail, domain: DomainInfo | null): Check[] {
  const syntaxOk = parsed.syntaxError === null && parsed.parts !== null;

  return [
    syntaxCheck(parsed),
    normalizationCheck(parsed, syntaxOk),
    providerRulesCheck(parsed, syntaxOk),
    typoCheck(parsed, syntaxOk),
    roleCheck(parsed, syntaxOk),
    disposableCheck(parsed, syntaxOk, domain),
    freeProviderCheck(parsed, syntaxOk),
    dnsCheck(domain, syntaxOk),
    parkingCheck(domain),
    mxProviderCheck(domain),
    mailboxCheck(),
  ];
}

function syntaxCheck(parsed: ParsedEmail): Check {
  const parts = parsed.parts;

  if (parsed.syntaxError !== null) {
    return {
      id: 'syntax',
      title: 'Syntax validation',
      outcome: 'fail',
      detail: parsed.syntaxError.detail,
      facts:
        parts === null
          ? []
          : [
              { label: 'Local part', value: parts.localPart, mono: true },
              { label: 'Domain part', value: parts.domain, mono: true },
            ],
    };
  }

  // parts is non-null whenever syntaxError is null; the guard is for the
  // type checker, not for a case that can happen.
  if (parts === null) {
    return {
      id: 'syntax',
      title: 'Syntax validation',
      outcome: 'skipped',
      detail: 'The address could not be split into a local part and a domain.',
      facts: [],
    };
  }

  const octets = Buffer.byteLength(`${parts.localPart}@${parts.domain}`, 'utf8');

  const facts: CheckFact[] = [
    { label: 'Local part', value: parts.localPart, mono: true },
    { label: 'Domain part', value: parts.domain, mono: true },
    {
      // Verifalia calls this "ASCII domain part". Saying outright that no
      // conversion was needed is more useful than omitting the row, because
      // it tells the reader the check happened.
      label: 'ASCII domain part',
      value: parts.idn
        ? `${parts.domainUnicode} was converted to ${parts.domain}`
        : 'Not internationalised — no punycode conversion needed',
      mono: parts.idn,
    },
    { label: 'Length', value: `${octets} of 254 octets`, mono: false },
  ];

  if (isQuoted(parts.localPart)) {
    facts.push({
      label: 'Quoted local part',
      value: 'Legal under RFC 5321, but many servers reject it',
    });
  }

  return {
    id: 'syntax',
    title: 'Syntax validation',
    outcome: 'pass',
    detail: 'The address is valid according to RFC 5321 and 5322 syntax rules.',
    facts,
  };
}

function normalizationCheck(parsed: ParsedEmail, syntaxOk: boolean): Check {
  if (!syntaxOk || parsed.normalized === null || parsed.canonical === null) {
    return skipped('normalization', 'Normalization and alias resolution', SYNTAX_BLOCKED);
  }

  const facts: CheckFact[] = [
    { label: 'Normalized', value: parsed.normalized, mono: true },
    { label: 'Canonical mailbox', value: parsed.canonical, mono: true },
  ];

  if (parsed.alias) {
    return {
      id: 'normalization',
      title: 'Normalization and alias resolution',
      // Not a warning. An alias is perfectly deliverable — it only matters
      // because two rows that look different are one mailbox, and the person
      // paying for a list clean wants to know that.
      outcome: 'info',
      detail:
        'This is an alias. Dots or a +tag were removed to find the mailbox it really delivers to — two rows sharing that canonical form are one person.',
      facts,
    };
  }

  return {
    id: 'normalization',
    title: 'Normalization and alias resolution',
    outcome: 'pass',
    detail:
      'Trimmed and lowercased. The address is already in its canonical form — no alias tricks in use.',
    facts,
  };
}

function providerRulesCheck(parsed: ParsedEmail, syntaxOk: boolean): Check {
  const title = 'Provider username rules';

  if (!syntaxOk || parsed.parts === null) return skipped('provider_rules', title, SYNTAX_BLOCKED);

  if (!isGmailDomain(parsed.parts.domain)) {
    return skipped(
      'provider_rules',
      title,
      'Not run — this check only applies to Gmail (gmail.com, googlemail.com).',
    );
  }

  if (parsed.providerRuleViolation !== null) {
    return {
      id: 'provider_rules',
      title,
      outcome: 'fail',
      detail: parsed.providerRuleViolation.detail,
      facts: [{ label: 'Rule broken', value: parsed.providerRuleViolation.failure, mono: true }],
    };
  }

  return {
    id: 'provider_rules',
    title,
    outcome: 'pass',
    detail: "The username follows Gmail's own signup rules for length and characters.",
    facts: [],
  };
}

function typoCheck(parsed: ParsedEmail, syntaxOk: boolean): Check {
  if (!syntaxOk) return skipped('typo', 'Domain spelling check', SYNTAX_BLOCKED);

  if (parsed.suggestion !== null) {
    return {
      id: 'typo',
      title: 'Domain spelling check',
      outcome: 'warn',
      detail: 'The domain is one or two keystrokes away from a far more common one.',
      facts: [{ label: 'Did they mean', value: parsed.suggestion, mono: true }],
    };
  }

  return {
    id: 'typo',
    title: 'Domain spelling check',
    outcome: 'pass',
    detail: 'The domain is not a near-miss of any well-known mail domain.',
    facts: [],
  };
}

function roleCheck(parsed: ParsedEmail, syntaxOk: boolean): Check {
  if (!syntaxOk) return skipped('role', 'Role-account validation', SYNTAX_BLOCKED);

  if (parsed.role) {
    return {
      id: 'role',
      title: 'Role-account validation',
      outcome: 'warn',
      detail:
        'The local part is a recognised role account. These reach a shared or automated inbox rather than one person, and they attract complaints in a campaign.',
      facts: [],
    };
  }

  return {
    id: 'role',
    title: 'Role-account validation',
    outcome: 'pass',
    detail:
      'The local part is not a role account — it is not one of the shared addresses an organisation publishes, such as admin@, info@ or support@.',
    facts: [],
  };
}

function disposableCheck(parsed: ParsedEmail, syntaxOk: boolean, domain: DomainInfo | null): Check {
  const title = 'Disposable address (DEA) validation';
  if (!syntaxOk) return skipped('disposable', title, SYNTAX_BLOCKED);

  if (parsed.disposable) {
    return {
      id: 'disposable',
      title,
      outcome: 'fail',
      detail:
        'The domain belongs to a known disposable mail provider. Addresses there are handed out to get past a signup form and stop working within days.',
      facts: [],
    };
  }

  // Feature 65. A domain not on the seed list can still route its mail
  // through a backend that serves nothing but disposable inboxes — Burner
  // Mail and Mailsac both let anyone point their own domain there.
  const mxChecked = domain !== null && domain.error == null;
  if (mxChecked && isDisposableMx(domain.mx)) {
    return {
      id: 'disposable',
      title,
      outcome: 'fail',
      detail:
        'The domain itself is not on the disposable list, but its mail exchanger belongs to a backend that serves nothing but disposable mail.',
      facts: [
        { label: 'Mail exchanger', value: domain.mx.find((host) => isDisposableMx([host])) ?? '', mono: true },
      ],
    };
  }

  return {
    id: 'disposable',
    title,
    outcome: 'pass',
    detail: mxChecked
      ? 'The domain is not on the disposable / temporary provider list, and its mail exchanger is not a known disposable-mail backend.'
      : 'The domain is not on the disposable / temporary provider list.',
    facts: [],
  };
}

function freeProviderCheck(parsed: ParsedEmail, syntaxOk: boolean): Check {
  if (!syntaxOk) return skipped('free_provider', 'Free email provider check', SYNTAX_BLOCKED);

  if (parsed.freeProvider) {
    return {
      id: 'free_provider',
      title: 'Free email provider check',
      // A consumer mailbox is a fact worth surfacing for B2B lists, and no
      // reason at all to hold the address back. Amber here would be wrong.
      outcome: 'info',
      detail:
        'This is a consumer mailbox on a free provider, not a company domain. Normal for B2C; worth knowing if the list is meant to be businesses.',
      facts: [],
    };
  }

  return {
    id: 'free_provider',
    title: 'Free email provider check',
    outcome: 'pass',
    detail: 'The domain is not a free consumer mail provider.',
    facts: [],
  };
}

function dnsCheck(domain: DomainInfo | null, syntaxOk: boolean): Check {
  const title = 'DNS record validation';

  if (!syntaxOk) return skipped('dns', title, SYNTAX_BLOCKED);
  if (domain === null) {
    return skipped('dns', title, 'Not run — this check was configured to skip DNS.');
  }

  // Feature 7 in report form. A resolver failure is not a finding about the
  // domain, and the report must not let it read as one.
  if (domain.error !== null) {
    return {
      id: 'dns',
      title,
      outcome: 'skipped',
      detail:
        domain.error === 'timeout'
          ? 'The DNS lookup timed out. Nothing about this domain was established — this is not a finding against the address.'
          : 'The DNS lookup failed. Nothing about this domain was established — this is not a finding against the address.',
      facts: [{ label: 'Resolver', value: domain.error, mono: true }],
    };
  }

  if (domain.nxdomain) {
    return {
      id: 'dns',
      title,
      outcome: 'fail',
      detail: 'The domain does not exist. No mail addressed to it can be delivered anywhere.',
      facts: [{ label: 'Result', value: 'NXDOMAIN', mono: true }],
    };
  }

  if (domain.nullMx) {
    return {
      id: 'dns',
      title,
      outcome: 'fail',
      detail:
        'The domain publishes a null MX (RFC 7505) — it states outright that it accepts no mail at all.',
      facts: [{ label: 'MX record', value: '.', mono: true }],
    };
  }

  if (domain.mx.length > 0) {
    return {
      id: 'dns',
      title,
      outcome: 'pass',
      detail: `The domain has ${domain.mx.length === 1 ? 'a mail exchanger' : `${domain.mx.length} mail exchangers`} and is set up to receive mail.`,
      facts: [{ label: 'Checked', value: 'MX records, in priority order' }],
      items: domain.mx,
    };
  }

  if (domain.hasAddressRecord) {
    return {
      id: 'dns',
      title,
      // Legal under RFC 5321 §5.1 and genuinely weaker evidence than an MX.
      // Amber, because a domain with no MX is more often a domain nobody
      // configured for mail than one deliberately relying on the fallback.
      outcome: 'warn',
      detail:
        'The domain has no MX record but does resolve to an address. Under RFC 5321 mail falls back to that host, so delivery is possible — but this is weaker evidence than a real MX.',
      facts: [{ label: 'Fallback', value: 'A / AAAA address record' }],
    };
  }

  return {
    id: 'dns',
    title,
    outcome: 'fail',
    detail:
      'The domain resolves but has nowhere to deliver mail — no MX record and no address record to fall back on.',
    facts: [],
  };
}

function parkingCheck(domain: DomainInfo | null): Check {
  const title = 'Parked domain check';

  if (domain === null || domain.error !== null) {
    return skipped('parking', title, 'Not run — no nameserver data was established for this domain.');
  }

  // Feature 66. `null` covers both a failed NS lookup and an older cache row
  // written before this check existed — either way, "not checked", not "not
  // parked", so the report says exactly that instead of guessing.
  if (domain.parked === null) {
    return skipped('parking', title, 'Not run — the nameserver lookup did not return a usable answer.');
  }

  if (domain.parked) {
    const hasMx = domain.mx.length > 0;
    return {
      id: 'parking',
      title,
      outcome: hasMx ? 'warn' : 'fail',
      detail: hasMx
        ? "The domain's nameservers belong to a parking service, though mail does appear to be forwarded somewhere — worth a human check before sending."
        : "The domain's nameservers belong to a parking service and it has no mail server — a for-sale or placeholder page, not an active mailbox.",
      facts: [],
    };
  }

  return {
    id: 'parking',
    title,
    outcome: 'pass',
    detail: "The domain's nameservers do not belong to any known parking service.",
    facts: [],
  };
}

function mxProviderCheck(domain: DomainInfo | null): Check {
  const title = 'Mail exchanger identification';

  if (domain === null || domain.error !== null || domain.provider === null) {
    return skipped(
      'mx_provider',
      title,
      'Not run — no mail exchanger was established for this domain.',
    );
  }

  return {
    id: 'mx_provider',
    title,
    outcome: 'info',
    detail: 'The platform running mail for this domain was identified from its MX hostnames.',
    facts: [{ label: 'Provider', value: domain.provider, mono: true }],
  };
}

/**
 * The one row that says what we did not do.
 *
 * Every competitor prints a green tick here. We print grey and a sentence,
 * because a tick would mean we opened an SMTP conversation with the receiving
 * server and we did not. Leaving the row out entirely would be worse — the
 * reader would assume the strongest check silently passed.
 */
function mailboxCheck(): Check {
  return {
    id: 'mailbox',
    title: 'Mailbox verification',
    outcome: 'skipped',
    detail:
      'Not performed. Confirming that one specific mailbox exists means holding an SMTP conversation with the receiving server, and every finding above stops short of that. Nothing in this report claims the mailbox is occupied.',
    facts: [],
  };
}

function skipped(id: CheckId, title: string, detail: string): Check {
  return { id, title, outcome: 'skipped', detail, facts: [] };
}
