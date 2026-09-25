import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { classify, parseEmail } from '../src/classify.ts';
import type { DomainInfo } from '../src/types.ts';

function domain(overrides: Partial<DomainInfo> = {}): DomainInfo {
  return {
    domain: 'example.com',
    mx: ['mail.example.com'],
    nullMx: false,
    hasAddressRecord: false,
    nxdomain: false,
    error: null,
    provider: 'other',
    parked: null,
    checkedAt: Date.now(),
    ...overrides,
  };
}

const check = (email: string, info: DomainInfo | null = domain()) =>
  classify(parseEmail(email), info);

describe('classify — undeliverable', () => {
  it('bad syntax, with full certainty', () => {
    const result = check('not-an-email');
    assert.equal(result.status, 'undeliverable');
    assert.equal(result.reason, 'syntax_invalid');
    assert.equal(result.confidence, 100);
    assert.equal(result.retryable, false);
  });

  it('domain does not exist', () => {
    const result = check('a@example.com', domain({ mx: [], nxdomain: true, provider: null }));
    assert.equal(result.status, 'undeliverable');
    assert.equal(result.reason, 'domain_not_found');
  });

  it('null MX — the domain says it takes no mail', () => {
    const result = check('a@example.com', domain({ mx: [], nullMx: true, provider: null }));
    assert.equal(result.status, 'undeliverable');
    assert.equal(result.reason, 'domain_null_mx');
  });

  it('no MX and no address record', () => {
    const result = check('a@example.com', domain({ mx: [], hasAddressRecord: false, provider: null }));
    assert.equal(result.status, 'undeliverable');
    assert.equal(result.reason, 'domain_no_mail_server');
  });
});

describe('classify — parked domains', () => {
  it('a parked domain with no mail server is risky, not undeliverable, and says do not send', () => {
    const result = check('a@parked-example.com', domain({
      mx: [], hasAddressRecord: true, provider: null, parked: true,
    }));
    assert.equal(result.status, 'risky');
    assert.equal(result.reason, 'domain_parked');
    assert.equal(result.advice, 'do_not_send');
  });

  it('a parked domain that still has an MX is risky but only asks for a review', () => {
    const result = check('a@parked-example.com', domain({
      mx: ['forward.example.net'], provider: null, parked: true,
    }));
    assert.equal(result.status, 'risky');
    assert.equal(result.reason, 'domain_parked_forwarding');
    assert.equal(result.advice, 'review');
  });

  it('an unresolved parked check never changes the verdict', () => {
    // `parked: null` — the NS lookup failed, or an old cache row predates
    // the column. Invariant 2: a failed bonus query is not a verdict.
    const result = check('a@example.com', domain({ parked: null }));
    assert.notEqual(result.reason, 'domain_parked');
    assert.notEqual(result.reason, 'domain_parked_forwarding');
  });
});

describe('classify — the DNS failure rule', () => {
  // The whole point of feature 7. Getting this wrong deletes good addresses
  // during a network blip, which is the worst thing this product can do.
  it('a resolver failure is unknown and retryable, never undeliverable', () => {
    for (const error of ['timeout', 'servfail', 'other'] as const) {
      const result = check('a@example.com', domain({ mx: [], error, provider: null }));
      assert.equal(result.status, 'unknown', error);
      assert.equal(result.retryable, true, error);
      assert.equal(result.confidence, 0, error);
    }
  });

  it('reports a timeout distinctly from a general failure', () => {
    assert.equal(check('a@x.com', domain({ error: 'timeout' })).reason, 'dns_timeout');
    assert.equal(check('a@x.com', domain({ error: 'servfail' })).reason, 'dns_error');
  });

  it('a DNS failure outranks a domain verdict read from the same missing data', () => {
    const result = check('a@example.com', domain({ mx: [], nxdomain: true, error: 'servfail' }));
    assert.equal(result.status, 'unknown');
  });

  it('but bad syntax still wins — no lookup could rescue it', () => {
    const result = check('bad..syntax@example.com', domain({ error: 'timeout' }));
    assert.equal(result.status, 'undeliverable');
  });
});

describe('classify — risky', () => {
  it('disposable domain', () => {
    const result = check('someone@mailinator.com');
    assert.equal(result.status, 'risky');
    assert.equal(result.reason, 'disposable_domain');
    assert.equal(result.flags.disposable, true);
  });

  it('disposable by mail exchanger — a domain not on any list, routed through a burner backend', () => {
    const result = check('someone@brand-new-burner.example', domain({
      domain: 'brand-new-burner.example',
      mx: ['mail.burnermail.io'],
      provider: null,
    }));
    assert.equal(result.status, 'risky');
    assert.equal(result.reason, 'disposable_domain');
    assert.equal(result.flags.disposable, true);
  });

  it('does not flag a domain on ordinary shared mail infrastructure as disposable', () => {
    const result = check('someone@a-real-company.example', domain({
      domain: 'a-real-company.example',
      mx: ['aspmx.l.google.com'],
      provider: 'google',
    }));
    assert.notEqual(result.reason, 'disposable_domain');
    assert.equal(result.flags.disposable, false);
  });

  it('role account', () => {
    const result = check('info@example.com');
    assert.equal(result.status, 'risky');
    assert.equal(result.reason, 'role_account');
  });

  it('suspected typo, and says what it thinks they meant', () => {
    const result = check('ahad@gmial.com');
    assert.equal(result.status, 'risky');
    assert.equal(result.reason, 'typo_suspected');
    assert.equal(result.suggestion, 'ahad@gmail.com');
  });

  it('ranks a wrong domain above a role name', () => {
    // if the domain is wrong, nothing else about the address matters
    assert.equal(check('info@gmial.com').reason, 'typo_suspected');
  });

  it('ranks a burner above everything else risky', () => {
    assert.equal(check('info@mailinator.com').reason, 'disposable_domain');
  });
});

describe('classify — unknown is the honest default', () => {
  it('never returns deliverable without SMTP, however good the domain looks', () => {
    const result = check('ahad.hossain@gmail.com', domain({
      domain: 'gmail.com',
      mx: ['gmail-smtp-in.l.google.com'],
      provider: 'google',
    }));
    assert.equal(result.status, 'unknown');
    assert.equal(result.reason, 'mailbox_unverified');
    assert.equal(result.confidence, 50);
    assert.equal(result.retryable, false);
    assert.equal(result.flags.mxProvider, 'google');
  });

  it('scores an A-record fallback below a real MX', () => {
    const result = check('a@example.com', domain({ mx: [], hasAddressRecord: true, provider: null }));
    assert.equal(result.status, 'unknown');
    assert.equal(result.confidence, 40);
  });

  it('marks a syntax-only pass as retryable so DNS still runs later', () => {
    const result = check('a@example.com', null);
    assert.equal(result.status, 'unknown');
    assert.equal(result.confidence, 30);
    assert.equal(result.retryable, true);
  });
});

describe('classify — advice is what to do, status is what we proved', () => {
  it('recommends sending when every check passed, though status stays unknown', () => {
    // The whole reason `advice` exists: "unknown" as a headline reads as
    // "we found nothing" when the finding is "we found nothing wrong".
    const result = check('ahad.hossain@gmail.com', domain({ domain: 'gmail.com', provider: 'google' }));
    assert.equal(result.advice, 'send');
    assert.equal(result.status, 'unknown');
  });

  it('never recommends sending to a provably dead address', () => {
    assert.equal(check('nope').advice, 'do_not_send');
    assert.equal(check('a@x.com', domain({ mx: [], nxdomain: true })).advice, 'do_not_send');
    assert.equal(check('a@x.com', domain({ mx: [], nullMx: true })).advice, 'do_not_send');
  });

  it('drops burner addresses outright but leaves role and typo to a human', () => {
    assert.equal(check('a@mailinator.com').advice, 'do_not_send');
    assert.equal(check('info@example.com').advice, 'review');
    assert.equal(check('a@gmial.com').advice, 'review');
  });

  it('asks for a retry rather than a decision when DNS failed', () => {
    const result = check('a@x.com', domain({ error: 'timeout' }));
    assert.equal(result.advice, 'retry');
    assert.equal(result.retryable, true);
  });

  it('gives every result an advice', () => {
    for (const email of ['x', 'a@b.com', 'info@mailinator.com', 'ahad@gmial.com']) {
      assert.ok(check(email).advice.length > 0, email);
    }
  });
});

describe('classify — result shape', () => {
  it('carries normalized, canonical and flags through', () => {
    const result = check('John.Doe+news@Gmail.com', domain({ domain: 'gmail.com', provider: 'google' }));
    assert.equal(result.input, 'John.Doe+news@Gmail.com');
    assert.equal(result.normalized, 'john.doe+news@gmail.com');
    assert.equal(result.canonical, 'johndoe@gmail.com');
    assert.equal(result.flags.alias, true);
    assert.equal(result.flags.freeProvider, true);
  });

  it('always fills status, confidence, reason and detail', () => {
    for (const email of ['x', 'a@b.com', 'info@mailinator.com', 'ahad@gmial.com']) {
      const result = check(email);
      assert.ok(result.status.length > 0, email);
      assert.ok(result.reason.length > 0, email);
      assert.ok(result.detail.length > 0, email);
      assert.ok(result.confidence >= 0 && result.confidence <= 100, email);
    }
  });
});
