/**
 * Feature 66 — parked domain detection.
 *
 * A domain whose nameservers belong to a parking service is not really in
 * use: someone registered it and never built anything there, or let it lapse,
 * and a marketplace or the registrar itself is serving a "for sale" or
 * ad-monetised placeholder in its place. An address at a domain like that is
 * not a real inbox — mail either has nowhere to go (no MX) or lands wherever
 * the parking service's forwarding was pointed, not at the organisation the
 * address looks like it belongs to.
 *
 * Every host below was checked against live DNS before being added, and only
 * kept once confirmed as a dedicated parking/marketplace brand. General-
 * purpose registrar nameservers used by countless ordinary, actively-run
 * websites — name.com, one.com, registrar-servers.com, markmonitor.com — are
 * deliberately left off even though broader public "parking nameserver"
 * lists include them: a real business sitting on its registrar's default NS
 * is not parked, and a false positive here tells a business to stop mailing
 * its own domain.
 */
const PARKING_NS_SUFFIXES = [
  'above.com',
  'afternic.com',
  'bodis.com',
  'brandbucket.com',
  'cashparking.com',
  'dan.com',
  'dnsowl.com',
  'domainmarket.com',
  'fabulous.com',
  'fastpark.net',
  'namefind.com',
  'parkingcrew.net',
  'parklogic.com',
  'perfectdomain.com',
  'pql.net',
  'searchfusion.com',
  'searchreinvented.com',
  'sedo.com',
  'sedoparking.com',
  'sonexo.com',
  'squadhelp.com',
  'sslparking.com',
  'undeveloped.com',
  'ztomy.com',
];

/**
 * Whether any nameserver for the domain belongs to a known parking service.
 * One extra NS query per domain, run alongside the MX/A lookup feature 5
 * already does — see dns.ts.
 */
export function isParkingNs(nsHosts: readonly string[]): boolean {
  return nsHosts.some((host) => {
    const value = host.toLowerCase().replace(/\.$/, '');
    return PARKING_NS_SUFFIXES.some(
      (suffix) => value === suffix || value.endsWith(`.${suffix}`),
    );
  });
}
