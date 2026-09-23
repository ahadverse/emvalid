import type { MxProvider } from '../types.ts';

/**
 * Feature 12 — work out who actually runs the mail for a domain from its MX
 * hostnames.
 *
 * Two payoffs. In the summary a user learns their list is mostly Google
 * Workspace. And when Deep Scan arrives, provider decides strategy: Google
 * and Microsoft answer every RCPT with "yes" regardless, so an SMTP probe
 * against them is worth nothing and should not even be attempted.
 */

const PATTERNS: ReadonlyArray<readonly [MxProvider, readonly string[]]> = [
  ['google', ['aspmx.l.google.com', 'googlemail.com', 'google.com', 'psmtp.com']],
  ['microsoft', ['outlook.com', 'protection.outlook.com', 'hotmail.com', 'microsoft.com', 'office365.us']],
  ['yahoo', ['yahoodns.net', 'yahoo.com', 'ymail.com']],
  ['zoho', ['zoho.com', 'zoho.eu', 'zohomail.com']],
  ['yandex', ['yandex.net', 'yandex.ru', 'mx.yandex.net']],
  ['proton', ['protonmail.ch', 'proton.me', 'protonmail.com']],
  ['icloud', ['icloud.com', 'apple.com', 'me.com']],
  ['fastmail', ['messagingengine.com', 'fastmail.com']],
  ['mailru', ['mail.ru', 'corp.mail.ru']],
  ['amazon-ses', ['amazonaws.com', 'amazonses.com']],
  ['mimecast', ['mimecast.com', 'mimecast.co.za']],
  ['proofpoint', ['pphosted.com', 'ppe-hosted.com', 'proofpoint.com']],
  ['barracuda', ['barracudanetworks.com', 'ess.barracudanetworks.com']],
  ['cpanel', ['cpanel.net', 'websitewelcome.com', 'hostgator.com', 'bluehost.com', 'namecheaphosting.com']],
  ['plesk', ['plesk.com']],
];

/**
 * Takes MX hostnames in priority order. Returns null only when there are no
 * hosts at all — an unrecognised host is 'other', which is a real answer
 * (self-hosted or a small provider), not a missing one.
 */
export function detectMxProvider(mxHosts: readonly string[]): MxProvider | null {
  if (mxHosts.length === 0) return null;

  for (const host of mxHosts) {
    const value = host.toLowerCase().replace(/\.$/, '');
    for (const [provider, suffixes] of PATTERNS) {
      if (suffixes.some((suffix) => value === suffix || value.endsWith(`.${suffix}`))) {
        return provider;
      }
    }
  }

  return 'other';
}

/**
 * Whether an SMTP probe against this provider tells us anything. Unused until
 * Deep Scan ships, but the knowledge belongs next to the detection.
 */
export function smtpProbeIsUseless(provider: MxProvider | null): boolean {
  return provider === 'google' || provider === 'microsoft' || provider === 'yahoo';
}
