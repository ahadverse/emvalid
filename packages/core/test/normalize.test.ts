import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { canonicalize, normalizeAddress, splitAddress } from '../src/normalize.ts';

describe('splitAddress', () => {
  it('trims and lowercases the domain', () => {
    const parts = splitAddress('  Ahad@Example.COM  ');
    assert.equal(parts?.localPart, 'Ahad');
    assert.equal(parts?.domain, 'example.com');
  });

  it('unwraps a display-name address', () => {
    const parts = splitAddress('Ahad Hossain <ahad@example.com>');
    assert.equal(parts?.localPart, 'ahad');
    assert.equal(parts?.domain, 'example.com');
  });

  it('drops the trailing FQDN dot', () => {
    assert.equal(splitAddress('a@example.com.')?.domain, 'example.com');
  });

  it('splits on the last unquoted @', () => {
    const parts = splitAddress('"weird@local"@example.com');
    assert.equal(parts?.localPart, '"weird@local"');
    assert.equal(parts?.domain, 'example.com');
  });

  it('converts IDN domains to punycode and flags them', () => {
    const parts = splitAddress('ahad@বাংলা.example');
    assert.equal(parts?.domain.startsWith('xn--'), true);
    assert.equal(parts?.idn, true);
  });

  it('rejects strings that cannot be an address', () => {
    assert.equal(splitAddress(''), null);
    assert.equal(splitAddress('not-an-email'), null);
    assert.equal(splitAddress('@example.com'), null);
    assert.equal(splitAddress('ahad@'), null);
  });
});

describe('normalizeAddress', () => {
  it('lowercases an unquoted local part', () => {
    assert.equal(normalizeAddress(splitAddress('John.Doe@Example.com')!), 'john.doe@example.com');
  });

  it('preserves case inside a quoted local part', () => {
    assert.equal(normalizeAddress(splitAddress('"John Doe"@Example.com')!), '"John Doe"@example.com');
  });
});

describe('canonicalize', () => {
  it('strips gmail dots and +tags, and folds googlemail', () => {
    assert.equal(canonicalize(splitAddress('J.Doe+news@googlemail.com')!), 'jdoe@gmail.com');
  });

  it('strips +tags but keeps dots on providers that keep them', () => {
    assert.equal(canonicalize(splitAddress('j.doe+shop@outlook.com')!), 'j.doe@outlook.com');
  });

  it('leaves custom domains completely alone', () => {
    // a.b@ and ab@ really can be different people on a self-hosted server
    assert.equal(canonicalize(splitAddress('a.b+tag@mycompany.com')!), 'a.b+tag@mycompany.com');
  });

  it('collapses aliases of the same mailbox to one key', () => {
    const key = (value: string) => canonicalize(splitAddress(value)!);
    assert.equal(key('John.Doe@gmail.com'), key('johndoe+promo@googlemail.com'));
  });
});
