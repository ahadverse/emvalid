import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isRoleAccount } from '../src/policy/role.ts';
import { isFreeProvider } from '../src/policy/free-providers.ts';
import { DisposableRegistry, isDisposable, isDisposableMx } from '../src/policy/disposable.ts';
import { damerauLevenshtein, suggestDomain } from '../src/policy/typo.ts';
import { detectMxProvider, smtpProbeIsUseless } from '../src/policy/mx-provider.ts';

describe('isRoleAccount', () => {
  it('catches the standard shared inboxes', () => {
    for (const local of ['admin', 'info', 'support', 'sales', 'postmaster', 'billing']) {
      assert.equal(isRoleAccount(local), true, local);
    }
  });

  it('is case-insensitive', () => {
    assert.equal(isRoleAccount('INFO'), true);
  });

  it('catches suffixed no-reply senders', () => {
    assert.equal(isRoleAccount('noreply-42'), true);
    assert.equal(isRoleAccount('no-reply.orders'), true);
  });

  it('leaves real names alone', () => {
    for (const local of ['ahad', 'ahad.hossain', 'infosys', 'adminah', 'sales.rahim.k']) {
      assert.equal(isRoleAccount(local), false, local);
    }
  });
});

describe('isFreeProvider', () => {
  it('knows the consumer providers', () => {
    assert.equal(isFreeProvider('gmail.com'), true);
    assert.equal(isFreeProvider('yahoo.co.uk'), true);
    assert.equal(isFreeProvider('yandex.ru'), true);
  });

  it('does not flag company domains', () => {
    assert.equal(isFreeProvider('anthropic.com'), false);
  });
});

describe('disposable', () => {
  it('matches seed domains', () => {
    assert.equal(isDisposable('mailinator.com'), true);
    assert.equal(isDisposable('YOPMAIL.com'), true);
  });

  it('matches subdomains of endless-subdomain services', () => {
    assert.equal(isDisposable('anything.mailinator.com'), true);
  });

  it('does not match a real domain that merely ends similarly', () => {
    assert.equal(isDisposable('notmailinator.com'), false);
  });

  it('merges a refreshed list without dropping the seed', () => {
    const registry = new DisposableRegistry();
    const before = registry.size;
    registry.add(['brand-new-burner.example', '# a comment', '  ']);
    assert.equal(registry.has('brand-new-burner.example'), true);
    assert.equal(registry.has('mailinator.com'), true);
    assert.equal(registry.size, before + 1);
  });
});

describe('isDisposableMx', () => {
  it('catches a brand-new domain routed through a known burner backend', () => {
    assert.equal(isDisposableMx(['mail.mailinator.com']), true);
    assert.equal(isDisposableMx(['mail.burnermail.io']), true);
  });

  it('matches a subdomain of the burner backend, not just the exact host', () => {
    assert.equal(isDisposableMx(['mx7.mailsac.com']), true);
  });

  it('never matches shared infrastructure, however popular with burner sites', () => {
    for (const host of ['aspmx.l.google.com', 'route1.mx.cloudflare.net', 'mxa.mailgun.org']) {
      assert.equal(isDisposableMx([host]), false, host);
    }
  });

  it('does not match a real domain that merely ends similarly', () => {
    assert.equal(isDisposableMx(['mail.notmailinator.com']), false);
  });

  it('returns false for an empty MX list', () => {
    assert.equal(isDisposableMx([]), false);
  });
});

describe('suggestDomain', () => {
  it('fixes the classic misspellings', () => {
    assert.equal(suggestDomain('gmial.com')?.domain, 'gmail.com');
    assert.equal(suggestDomain('gmai.com')?.domain, 'gmail.com');
    assert.equal(suggestDomain('yahooo.com')?.domain, 'yahoo.com');
    assert.equal(suggestDomain('hotmial.com')?.domain, 'hotmail.com');
  });

  it('fixes a bad TLD on a domain it recognises', () => {
    assert.equal(suggestDomain('gmail.con')?.domain, 'gmail.com');
    assert.equal(suggestDomain('yahoo.cm')?.domain, 'yahoo.com');
  });

  it('never corrects a domain that is already right', () => {
    for (const domain of ['gmail.com', 'outlook.com', 'proton.me']) {
      assert.equal(suggestDomain(domain), null, domain);
    }
  });

  it('leaves unrelated company domains alone', () => {
    for (const domain of ['anthropic.com', 'mycompany.io', 'dis-bd.com', 'shopify.com']) {
      assert.equal(suggestDomain(domain), null, domain);
    }
  });

  it('does not rewrite an odd TLD on an unknown domain', () => {
    // .con is wrong, but we have no idea what they meant — leave it
    assert.equal(suggestDomain('mycompany.con'), null);
  });
});

describe('damerauLevenshtein', () => {
  it('counts a transposition as one edit', () => {
    assert.equal(damerauLevenshtein('gmial', 'gmail'), 1);
  });

  it('returns null once the max is exceeded', () => {
    assert.equal(damerauLevenshtein('completely', 'different', 2), null);
  });

  it('is zero for identical strings', () => {
    assert.equal(damerauLevenshtein('same', 'same'), 0);
  });
});

describe('detectMxProvider', () => {
  it('identifies Google Workspace', () => {
    assert.equal(detectMxProvider(['aspmx.l.google.com', 'alt1.aspmx.l.google.com']), 'google');
  });

  it('identifies Microsoft 365', () => {
    assert.equal(detectMxProvider(['example-com.mail.protection.outlook.com']), 'microsoft');
  });

  it('calls an unknown host other, not null', () => {
    assert.equal(detectMxProvider(['mail.selfhosted.example']), 'other');
  });

  it('returns null only when there are no hosts', () => {
    assert.equal(detectMxProvider([]), null);
  });

  it('knows which providers make an SMTP probe pointless', () => {
    assert.equal(smtpProbeIsUseless('google'), true);
    assert.equal(smtpProbeIsUseless('other'), false);
  });
});
