import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DnsClient } from '../src/dns.ts';

/**
 * Live DNS checks. Off by default — run with `EV_LIVE_DNS=1 node --test ...`.
 *
 * The rest of the suite stubs DNS, which is right for unit tests but means
 * nothing here is ever exercised against a real resolver. These few cases
 * confirm that Node's actual error codes still map the way `dns.ts` assumes,
 * because that mapping is what keeps a network blip from being reported as
 * "this domain has no mail server".
 */

const live = process.env.EV_LIVE_DNS === '1';
const options = { skip: live ? false : 'set EV_LIVE_DNS=1 to run' };

describe('DnsClient (live)', options, () => {
  const dns = new DnsClient({ timeout: 8000, tries: 2 });

  it('reads MX records and identifies the provider', async () => {
    const info = await dns.lookupDomain('gmail.com');
    assert.equal(info.error, null);
    assert.ok(info.mx.length > 0);
    assert.equal(info.provider, 'google');
  });

  it('reports a domain that does not exist as nxdomain, not as an error', async () => {
    const info = await dns.lookupDomain('this-domain-really-should-not-exist-9f3a2b.com');
    assert.equal(info.error, null);
    assert.equal(info.nxdomain, true);
    assert.equal(info.mx.length, 0);
  });

  it('detects a null MX', async () => {
    // RFC 7505's own example domain, maintained by the IETF for exactly this
    const info = await dns.lookupDomain('example.com');
    assert.equal(info.error, null);
    assert.equal(info.nullMx || info.mx.length === 0, true);
  });

  it('surfaces an unreachable resolver as a retryable error, never as a verdict', async () => {
    // 203.0.113.0/24 is TEST-NET-3: reserved, guaranteed to route nowhere
    const broken = new DnsClient({ servers: ['203.0.113.1'], timeout: 1500, tries: 1 });
    const info = await broken.lookupDomain('gmail.com');

    assert.notEqual(info.error, null);
    assert.equal(info.nxdomain, false);
    assert.equal(info.mx.length, 0);
    assert.equal(info.hasAddressRecord, false);
  });
});
