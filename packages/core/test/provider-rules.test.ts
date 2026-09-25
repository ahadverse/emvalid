import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { checkProviderUsernameRules } from '../src/policy/provider-rules.ts';

describe('checkProviderUsernameRules', () => {
  it('only applies to gmail.com and googlemail.com', () => {
    assert.equal(checkProviderUsernameRules('outlook.com', 'ab'), null);
    assert.equal(checkProviderUsernameRules('yahoo.com', 'ab'), null);
    assert.equal(checkProviderUsernameRules('example.com', 'ab'), null);
  });

  it('is case-insensitive on the domain', () => {
    assert.notEqual(checkProviderUsernameRules('Gmail.COM', 'ab'), null);
    assert.notEqual(checkProviderUsernameRules('GOOGLEMAIL.com', 'ab'), null);
  });

  it('accepts a normal Gmail username', () => {
    assert.equal(checkProviderUsernameRules('gmail.com', 'ahad.hossain'), null);
    assert.equal(checkProviderUsernameRules('googlemail.com', 'ahad.hossain'), null);
  });

  it('rejects a username shorter than 6 characters', () => {
    const result = checkProviderUsernameRules('gmail.com', 'ahad');
    assert.equal(result?.failure, 'too_short');
    assert.equal(result?.provider, 'gmail');
  });

  it('rejects a username longer than 30 characters', () => {
    const result = checkProviderUsernameRules('gmail.com', 'a'.repeat(31));
    assert.equal(result?.failure, 'too_long');
  });

  it('accepts the boundary lengths', () => {
    assert.equal(checkProviderUsernameRules('gmail.com', 'a'.repeat(6)), null);
    assert.equal(checkProviderUsernameRules('gmail.com', 'a'.repeat(30)), null);
  });

  it('rejects a character outside letters, digits and dots', () => {
    for (const local of ['ahad_hossain', 'ahad-hossain', 'ahad hossain', 'ahad@hossain']) {
      assert.equal(checkProviderUsernameRules('gmail.com', local)?.failure, 'invalid_character', local);
    }
  });

  it('rejects a username that does not start with a letter', () => {
    assert.equal(checkProviderUsernameRules('gmail.com', '1ahadhossain')?.failure, 'must_start_with_letter');
  });

  it('rejects a leading or trailing dot', () => {
    assert.equal(checkProviderUsernameRules('gmail.com', '.ahadhossain')?.failure, 'leading_or_trailing_dot');
    assert.equal(checkProviderUsernameRules('gmail.com', 'ahadhossain.')?.failure, 'leading_or_trailing_dot');
  });

  it('rejects two dots in a row', () => {
    assert.equal(checkProviderUsernameRules('gmail.com', 'ahad..hossain')?.failure, 'consecutive_dots');
  });

  it('ignores everything from the first + tag onward', () => {
    // The tag itself would fail every rule above; none of that applies to it.
    assert.equal(checkProviderUsernameRules('gmail.com', 'ahad.hossain+news_letter!'), null);
  });

  it('checks only the base username length, not the tag', () => {
    // Base is 4 chars ("ahad") — too short even though the full local part is long.
    assert.equal(checkProviderUsernameRules('gmail.com', 'ahad+a-very-long-tag')?.failure, 'too_short');
  });

  it('is case-insensitive on the username charset', () => {
    assert.equal(checkProviderUsernameRules('gmail.com', 'AhadHossain'), null);
  });
});
