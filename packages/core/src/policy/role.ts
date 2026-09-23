/**
 * Feature 9 — role account detection.
 *
 * These addresses reach a shared inbox, a ticket system, or nobody at all.
 * They are usually perfectly deliverable, which is exactly why they are
 * dangerous: mailing them looks fine in the metrics and produces complaints.
 * RFC 2142 defines the first group; the rest is what shows up in real lists.
 */

const ROLE_LOCAL_PARTS = new Set([
  // RFC 2142
  'postmaster', 'hostmaster', 'webmaster', 'abuse', 'noc', 'security',
  'usenet', 'news', 'uucp', 'ftp', 'www',
  // administrative
  'admin', 'administrator', 'root', 'sysadmin', 'operations', 'ops',
  // shared inboxes
  'info', 'contact', 'hello', 'hi', 'enquiries', 'enquiry', 'inquiries',
  'inquiry', 'general', 'mail', 'email', 'office', 'reception', 'team',
  // function-specific
  'support', 'help', 'helpdesk', 'service', 'customerservice', 'care',
  'sales', 'marketing', 'billing', 'accounts', 'accounting', 'finance',
  'invoice', 'invoices', 'payments', 'orders', 'order', 'purchasing',
  'hr', 'jobs', 'careers', 'recruitment', 'recruiting', 'hiring',
  'legal', 'compliance', 'privacy', 'dpo', 'press', 'media', 'pr',
  'partners', 'partnership', 'business', 'bd', 'dev', 'devops', 'it',
  // automated senders — mailing these is always wrong
  'noreply', 'no-reply', 'donotreply', 'do-not-reply', 'notification',
  'notifications', 'alerts', 'alert', 'bounce', 'bounces', 'mailer-daemon',
  'daemon', 'automailer', 'robot', 'bot', 'system', 'server',
  // list machinery
  'subscribe', 'unsubscribe', 'listserv', 'majordomo', 'owner', 'request',
]);

/** Prefixes that make a role account no matter what follows. */
const ROLE_PREFIXES = ['noreply', 'no-reply', 'donotreply', 'do-not-reply', 'mailer-daemon'];

export function isRoleAccount(localPart: string): boolean {
  const local = localPart.toLowerCase();
  if (ROLE_LOCAL_PARTS.has(local)) return true;

  // `noreply-42@`, `no-reply.orders@` — same thing wearing a suffix.
  return ROLE_PREFIXES.some(
    (prefix) =>
      local.startsWith(prefix) &&
      (local.length === prefix.length || /^[.\-_+]/.test(local.slice(prefix.length))),
  );
}
