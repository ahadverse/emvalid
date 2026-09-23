/**
 * Feature 10 — free/consumer mailbox detection.
 *
 * Not a quality signal on its own: a gmail.com address is as deliverable as
 * any. It matters for B2B filtering ("only company domains") and for SMTP
 * strategy later — the big consumer providers are exactly the ones that lie
 * to a verifier, so Deep Scan will have to treat them differently.
 */

const FREE_PROVIDERS = new Set([
  // Google
  'gmail.com', 'googlemail.com',
  // Microsoft
  'outlook.com', 'outlook.co.uk', 'outlook.fr', 'outlook.de', 'outlook.es',
  'hotmail.com', 'hotmail.co.uk', 'hotmail.fr', 'hotmail.de', 'hotmail.it',
  'hotmail.es', 'live.com', 'live.co.uk', 'live.nl', 'live.fr', 'live.ca',
  'msn.com', 'passport.com', 'windowslive.com',
  // Yahoo
  'yahoo.com', 'yahoo.co.uk', 'yahoo.co.in', 'yahoo.co.jp', 'yahoo.fr',
  'yahoo.de', 'yahoo.es', 'yahoo.it', 'yahoo.ca', 'yahoo.com.au',
  'yahoo.com.br', 'yahoo.com.mx', 'yahoo.in', 'ymail.com', 'rocketmail.com',
  // Apple
  'icloud.com', 'me.com', 'mac.com',
  // privacy-focused
  'protonmail.com', 'protonmail.ch', 'proton.me', 'pm.me',
  'tutanota.com', 'tutanota.de', 'tuta.io', 'tuta.com',
  'hushmail.com', 'countermail.com', 'posteo.de', 'mailbox.org',
  // other global
  'aol.com', 'aim.com', 'gmx.com', 'gmx.de', 'gmx.net', 'gmx.at', 'gmx.ch',
  'web.de', 'mail.com', 'email.com', 'usa.com', 'zoho.com', 'zohomail.com',
  'fastmail.com', 'fastmail.fm', 'hey.com', 'inbox.com', 'lycos.com',
  'rediffmail.com', 'sify.com', 'indiatimes.com',
  // Russia / Eastern Europe
  'yandex.ru', 'yandex.com', 'yandex.by', 'yandex.kz', 'ya.ru',
  'mail.ru', 'inbox.ru', 'list.ru', 'bk.ru', 'internet.ru', 'rambler.ru',
  'seznam.cz', 'wp.pl', 'o2.pl', 'onet.pl', 'interia.pl',
  // Asia
  'qq.com', '163.com', '126.com', 'sina.com', 'sina.cn', 'sohu.com',
  'foxmail.com', 'aliyun.com', 'naver.com', 'daum.net', 'hanmail.net',
  'nate.com', 'docomo.ne.jp', 'ezweb.ne.jp', 'softbank.ne.jp',
  'nifty.com', 'biglobe.ne.jp', 'so-net.ne.jp',
  // Bangladesh / South Asia ISPs
  'bdmail.net', 'agni.com', 'citechco.net', 'dhaka.net',
  // Europe
  'orange.fr', 'wanadoo.fr', 'free.fr', 'laposte.net', 'sfr.fr', 'bbox.fr',
  'libero.it', 'virgilio.it', 'tiscali.it', 'alice.it', 'tin.it',
  'terra.com.br', 'uol.com.br', 'bol.com.br', 'ig.com.br',
  't-online.de', 'freenet.de', 'arcor.de', 'online.de',
  'telenet.be', 'skynet.be', 'ziggo.nl', 'kpnmail.nl', 'home.nl',
  'bluewin.ch', 'sunrise.ch', 'chello.at', 'aon.at',
  'btinternet.com', 'sky.com', 'virginmedia.com', 'talktalk.net',
  'ntlworld.com', 'blueyonder.co.uk', 'tiscali.co.uk',
  // North America ISPs
  'comcast.net', 'verizon.net', 'att.net', 'sbcglobal.net', 'bellsouth.net',
  'cox.net', 'charter.net', 'earthlink.net', 'juno.com', 'netzero.net',
  'optonline.net', 'roadrunner.com', 'rr.com', 'shaw.ca', 'rogers.com',
  'sympatico.ca', 'telus.net', 'videotron.ca',
  // Oceania / Africa
  'bigpond.com', 'bigpond.net.au', 'optusnet.com.au', 'iinet.net.au',
  'xtra.co.nz', 'webmail.co.za', 'telkomsa.net',
]);

export function isFreeProvider(domain: string): boolean {
  return FREE_PROVIDERS.has(domain);
}

/** Exposed so the typo checker can score against known-good domains. */
export function freeProviderDomains(): ReadonlySet<string> {
  return FREE_PROVIDERS;
}
