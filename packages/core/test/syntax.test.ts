import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { splitAddress } from '../src/normalize.ts';
import { checkSyntax, type SyntaxFailure } from '../src/syntax.ts';

function verdict(email: string) {
  const parts = splitAddress(email);
  assert.notEqual(parts, null, `could not split ${email}`);
  return checkSyntax(parts!);
}

function assertOk(email: string) {
  const result = verdict(email);
  assert.equal(result.ok, true, `expected ${email} to pass, got ${JSON.stringify(result)}`);
}

function assertFails(email: string, failure: SyntaxFailure) {
  const result = verdict(email);
  assert.equal(result.ok, false, `expected ${email} to fail`);
  assert.equal(result.ok === false ? result.failure : null, failure);
}

describe('checkSyntax — accepts', () => {
  for (const email of [
    'simple@example.com',
    'very.common@example.com',
    'disposable.style.email.with+symbol@example.com',
    "other.email-with-hyphen@and.subdomains.example.com",
    'fully-qualified-domain@example.co.uk',
    'user.name+tag+sorting@example.com',
    'x@example.com',
    "!#$%&'*+-/=?^_`{|}~@example.com",
    '"quoted name"@example.com',
    '"very.unusual.@.unusual.com"@example.com',
    'ahad@xn--54b7fta0cc.example',
  ]) {
    it(email, () => assertOk(email));
  }
});

describe('checkSyntax — rejects', () => {
  const cases: Array<[string, SyntaxFailure]> = [
    ['.leading@example.com', 'local_dot_position'],
    ['trailing.@example.com', 'local_dot_position'],
    ['double..dot@example.com', 'local_dot_position'],
    ['spaces are bad@example.com', 'local_bad_char'],
    ['back\\slash@example.com', 'local_bad_char'],
    ['"unclosed@example.com', 'local_unterminated_quote'],
    [`${'a'.repeat(65)}@example.com`, 'local_too_long'],
    ['user@localhost', 'domain_single_label'],
    ['user@example..com', 'domain_label_empty'],
    ['user@-example.com', 'domain_hyphen_position'],
    ['user@example-.com', 'domain_hyphen_position'],
    ['user@192.168.1.1', 'domain_ip_literal'],
    ['user@[192.168.1.1]', 'domain_ip_literal'],
    ['user@example.c', 'domain_bad_tld'],
    ['user@example.123', 'domain_bad_tld'],
    [`user@${'a'.repeat(64)}.com`, 'domain_label_too_long'],
  ];

  for (const [email, failure] of cases) {
    it(`${email} → ${failure}`, () => assertFails(email, failure));
  }

  it('rejects an address over the 254 octet wire limit', () => {
    // 64 + 1 + 192 = 257, with every individual part still legal
    const local = 'a'.repeat(64);
    const domain = `${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(60)}.com`;
    assertFails(`${local}@${domain}`, 'address_too_long');
  });
});
