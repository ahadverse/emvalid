import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseEmail } from '../src/classify.ts';
import { explain, type Check, type CheckId } from '../src/explain.ts';
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

const report = (email: string, info: DomainInfo | null = domain()) =>
  explain(parseEmail(email), info);

const find = (checks: Check[], id: CheckId): Check => {
  const check = checks.find((item) => item.id === id);
  assert.ok(check !== undefined, `no check with id ${id}`);
  return check;
};

describe('explain — shape', () => {
  it('every check is reported, every time', () => {
    // A report whose length changes with the verdict cannot be read as a
    // checklist. Absence of a row must never be how we say "not applicable".
    const lengths = new Set(
      ['a@example.com', 'nonsense', 'admin@example.com', 'x@mailinator.com'].map(
        (email) => report(email).length,
      ),
    );
    assert.equal(lengths.size, 1);
  });

  it('ids are unique — the UI keys rows on them', () => {
    const checks = report('a@example.com');
    assert.equal(new Set(checks.map((check) => check.id)).size, checks.length);
  });
});

describe('explain — syntax', () => {
  it('a clean address passes and shows its parts', () => {
    const syntax = find(report('Ahad.Hossain@Example.com'), 'syntax');
    assert.equal(syntax.outcome, 'pass');
    assert.deepEqual(
      syntax.facts.find((fact) => fact.label === 'Local part')?.value,
      'Ahad.Hossain',
    );
    assert.equal(syntax.facts.find((fact) => fact.label === 'Domain part')?.value, 'example.com');
  });

  it('a broken address fails, and every policy check below it says it did not run', () => {
    const checks = report('not-an-email', null);
    assert.equal(find(checks, 'syntax').outcome, 'fail');

    for (const id of ['normalization', 'provider_rules', 'typo', 'role', 'disposable', 'free_provider'] as const) {
      assert.equal(find(checks, id).outcome, 'skipped', id);
    }
  });

  it('an IDN domain records the punycode conversion', () => {
    const syntax = find(report('a@münchen.de', domain({ domain: 'xn--mnchen-3ya.de' })), 'syntax');
    const ascii = syntax.facts.find((fact) => fact.label === 'ASCII domain part')?.value ?? '';
    assert.match(ascii, /xn--mnchen-3ya\.de/);
  });
});

describe('explain — policy', () => {
  it('a role address warns', () => {
    assert.equal(find(report('admin@example.com'), 'role').outcome, 'warn');
  });

  it('a disposable domain fails', () => {
    assert.equal(find(report('a@mailinator.com'), 'disposable').outcome, 'fail');
  });

  it('fails a domain not on any list when its MX is a known burner backend', () => {
    const check = find(
      report('a@brand-new-burner.example', domain({ domain: 'brand-new-burner.example', mx: ['mail.burnermail.io'] })),
      'disposable',
    );
    assert.equal(check.outcome, 'fail');
    assert.equal(check.facts.find((fact) => fact.label === 'Mail exchanger')?.value, 'mail.burnermail.io');
  });

  it('a free provider is noted, not warned about', () => {
    // gmail.com is a fact about the address, not a reason to hold it back.
    // Amber here would push people to delete perfectly good consumer addresses.
    assert.equal(find(report('a@gmail.com'), 'free_provider').outcome, 'info');
  });

  it('a misspelled domain offers the correction', () => {
    const typo = find(report('a@gmial.com'), 'typo');
    assert.equal(typo.outcome, 'warn');
    assert.equal(typo.facts[0]?.value, 'a@gmail.com');
  });

  it('an alias is noted with the mailbox it collapses to', () => {
    const check = find(report('j.doe+news@gmail.com'), 'normalization');
    assert.equal(check.outcome, 'info');
    assert.equal(
      check.facts.find((fact) => fact.label === 'Canonical mailbox')?.value,
      'jdoe@gmail.com',
    );
  });
});

describe('explain — provider rules', () => {
  it('is not run for a non-Gmail domain', () => {
    const check = find(report('a@example.com'), 'provider_rules');
    assert.equal(check.outcome, 'skipped');
  });

  it('passes a Gmail username that follows the rules', () => {
    const check = find(report('ahad.hossain@gmail.com'), 'provider_rules');
    assert.equal(check.outcome, 'pass');
  });

  it('fails a Gmail username the provider would never let anyone register', () => {
    const check = find(report('ahad@gmail.com'), 'provider_rules');
    assert.equal(check.outcome, 'fail');
    assert.equal(check.facts.find((fact) => fact.label === 'Rule broken')?.value, 'too_short');
  });
});

describe('explain — DNS', () => {
  it('lists the mail exchangers in priority order', () => {
    const dns = find(report('a@example.com', domain({ mx: ['mx1.example.com', 'mx2.example.com'] })), 'dns');
    assert.equal(dns.outcome, 'pass');
    assert.deepEqual(dns.items, ['mx1.example.com', 'mx2.example.com']);
  });

  it('an A-record fallback warns rather than passing', () => {
    const dns = find(
      report('a@example.com', domain({ mx: [], hasAddressRecord: true, provider: null })),
      'dns',
    );
    assert.equal(dns.outcome, 'warn');
  });

  it('nxdomain and null MX are failures', () => {
    assert.equal(
      find(report('a@example.com', domain({ mx: [], nxdomain: true, provider: null })), 'dns')
        .outcome,
      'fail',
    );
    assert.equal(
      find(report('a@example.com', domain({ mx: [], nullMx: true, provider: null })), 'dns')
        .outcome,
      'fail',
    );
  });

  it('a resolver failure is "not run", never a failure of the address', () => {
    // The report-side half of feature 7. Colouring this red is how a tool
    // talks someone into deleting good addresses during a network blip.
    for (const error of ['timeout', 'servfail', 'other'] as const) {
      const dns = find(report('a@example.com', domain({ mx: [], error, provider: null })), 'dns');
      assert.equal(dns.outcome, 'skipped', error);
      assert.equal(find(report('a@example.com', domain({ mx: [], error, provider: null })), 'parking').outcome, 'skipped', error);
    }
  });

  it('DNS not run at all is reported as not run', () => {
    assert.equal(find(report('a@example.com', null), 'dns').outcome, 'skipped');
    assert.equal(find(report('a@example.com', null), 'mx_provider').outcome, 'skipped');
    assert.equal(find(report('a@example.com', null), 'parking').outcome, 'skipped');
  });
});

describe('explain — parked domains', () => {
  it('is not run when the nameserver lookup never resolved', () => {
    // `parked: null` — a failed NS query, or an old cache row from before
    // this column existed. Either way this must read as "not checked".
    const check = find(report('a@example.com', domain({ parked: null })), 'parking');
    assert.equal(check.outcome, 'skipped');
  });

  it('passes a domain whose nameservers are not a known parking service', () => {
    assert.equal(find(report('a@example.com', domain({ parked: false })), 'parking').outcome, 'pass');
  });

  it('fails a parked domain with no mail server', () => {
    const check = find(report('a@parked-example.com', domain({ mx: [], parked: true })), 'parking');
    assert.equal(check.outcome, 'fail');
  });

  it('warns rather than fails when a parked domain still has an MX', () => {
    const check = find(
      report('a@parked-example.com', domain({ mx: ['forward.example.net'], parked: true })),
      'parking',
    );
    assert.equal(check.outcome, 'warn');
  });
});

describe('explain — the mailbox row', () => {
  it('is always present and never claims to have passed', () => {
    // The one row the product exists to be honest about. If this ever goes
    // green without an SMTP conversation behind it, the report is lying.
    for (const email of ['a@example.com', 'nonsense', 'admin@gmail.com']) {
      const mailbox = find(report(email), 'mailbox');
      assert.equal(mailbox.outcome, 'skipped', email);
      assert.match(mailbox.detail, /Not performed/);
    }
  });
});
