/**
 * Feature 8 — disposable / burner domain detection. ~85%, and it cannot be
 * better than that by design.
 *
 * A temp-mail service can register a new domain this morning and no list will
 * know about it until someone notices. So this ships a seed list of the
 * services that actually show up in bulk lists, and a registry the platform
 * refreshes from a bigger public list on a schedule. Detection here is a
 * *risky* signal, never *undeliverable* — a burner address usually does
 * accept mail, it just belongs to nobody.
 */

/** The services worth catching without any external data at all. */
const SEED_DISPOSABLE = [
  '0-mail.com', '10minutemail.com', '10minutemail.net', '20minutemail.com',
  '33mail.com', 'anonbox.net', 'anonymbox.com', 'armyspy.com',
  'burnermail.io', 'byom.de', 'cuvox.de', 'dayrep.com', 'deadaddress.com',
  'despam.it', 'dispostable.com', 'dodgeit.com', 'dodgit.com',
  'dropmail.me', 'duck.com', 'e4ward.com', 'einrot.com', 'emailfake.com',
  'emailondeck.com', 'emailtemporanea.net', 'emltmp.com', 'ephemeral.email',
  'fakeinbox.com', 'fakemail.net', 'fakemailgenerator.com', 'filzmail.com',
  'fleckens.hu', 'getairmail.com', 'getnada.com', 'gishpuppy.com',
  'grr.la', 'guerrillamail.biz', 'guerrillamail.com', 'guerrillamail.de',
  'guerrillamail.info', 'guerrillamail.net', 'guerrillamail.org',
  'guerrillamailblock.com', 'harakirimail.com', 'incognitomail.com',
  'inboxbear.com', 'inboxkitten.com', 'jetable.org', 'kasmail.com',
  'killmail.com', 'klzlk.com', 'koszmail.pl', 'linshiyouxiang.net',
  'luxusmail.org', 'mailcatch.com', 'maildrop.cc', 'mailduck.io',
  'maileater.com', 'mailexpire.com', 'mailforspam.com', 'mailfreeonline.com',
  'mailinater.com', 'mailinator.com', 'mailinator.net', 'mailmetrash.com',
  'mailnesia.com', 'mailnull.com', 'mailsac.com', 'mailtemp.info',
  'mailtothis.com', 'mintemail.com', 'mohmal.com', 'moakt.com',
  'msgsafe.io', 'mt2015.com', 'mytemp.email', 'mytrashmail.com',
  'nowmymail.com', 'nwytg.net', 'objectmail.com', 'oneoffmail.com',
  'owlymail.com', 'pokemail.net', 'proxymail.eu', 'rcpt.at',
  'reallymymail.com', 'rhyta.com', 'rmqkr.net', 'safetymail.info',
  'sharklasers.com', 'shitmail.me', 'sinnlos-mail.de', 'slopsbox.com',
  'smashmail.de', 'spam4.me', 'spamavert.com', 'spambog.com', 'spambox.us',
  'spamcowboy.com', 'spamdecoy.net', 'spamex.com', 'spamfree24.org',
  'spamgourmet.com', 'spamherelots.com', 'spamhole.com', 'spaml.com',
  'spamspot.com', 'spamthis.co.uk', 'superrito.com', 'tafmail.com',
  'teleworm.us', 'temp-mail.io', 'temp-mail.org', 'tempail.com',
  'tempemail.net', 'tempinbox.com', 'tempm.com', 'tempmail.altmails.com',
  'tempmail.dev', 'tempmail.ninja', 'tempmail.plus', 'tempmailo.com',
  'tempmailer.com', 'tempr.email', 'throwawaymail.com', 'tmail.ws',
  'tmailor.com', 'trash-mail.com', 'trashmail.com', 'trashmail.de',
  'trashmail.me', 'trashmail.net', 'trbvm.com', 'trillianpro.com',
  'tvchd.com', 'vomoto.com', 'wegwerfmail.de', 'wegwerfmail.net',
  'wh4f.org', 'willselfdestruct.com', 'yopmail.com', 'yopmail.fr',
  'yopmail.net', 'zetmail.com',
];

/**
 * Services that hand out endless subdomains — `anything.mailinator.com`.
 * Matching only the exact domain would miss most of their traffic.
 */
const SEED_SUFFIXES = [
  'mailinator.com', 'guerrillamail.com', 'yopmail.com', 'trashmail.com',
  '33mail.com', 'maildrop.cc', 'mailsac.com', 'dropmail.me', 'moakt.com',
  'temp-mail.org', 'tempr.email', 'nwytg.net', 'grr.la',
];

export class DisposableRegistry {
  #exact: Set<string>;
  #suffixes: string[];

  constructor(domains: Iterable<string> = SEED_DISPOSABLE, suffixes: Iterable<string> = SEED_SUFFIXES) {
    this.#exact = new Set([...domains].map((d) => d.toLowerCase()));
    this.#suffixes = [...suffixes].map((s) => s.toLowerCase());
  }

  has(domain: string): boolean {
    const value = domain.toLowerCase();
    if (this.#exact.has(value)) return true;
    return this.#suffixes.some((suffix) => value.endsWith(`.${suffix}`));
  }

  /**
   * Merge in a refreshed list. Additive on purpose — a public list going
   * briefly empty or unreachable must never silently turn detection off.
   */
  add(domains: Iterable<string>): void {
    for (const domain of domains) {
      const value = domain.trim().toLowerCase();
      if (value.length > 0 && !value.startsWith('#')) this.#exact.add(value);
    }
  }

  get size(): number {
    return this.#exact.size;
  }
}

/** Shared default instance. The platform swaps in a refreshed one at boot. */
export const disposableRegistry = new DisposableRegistry();

export function isDisposable(domain: string): boolean {
  return disposableRegistry.has(domain);
}
