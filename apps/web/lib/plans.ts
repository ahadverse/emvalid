/**
 * The plans, in one place.
 *
 * Data rather than markup, because both the cards (a client component, for the
 * monthly/yearly switch) and the comparison table (a server component) are
 * drawn from it. Two hardcoded copies of a price is how a pricing page ends up
 * quoting two different numbers on the same screen.
 *
 * It lives in lib/ rather than beside the cards for a Next-specific reason:
 * every export of a `'use client'` module becomes a client reference when a
 * Server Component imports it, so the table would receive a proxy where it
 * expected an array.
 *
 * Prices are Bangladeshi taka per month. Nothing here is metered yet — see the
 * billing notice on app/pricing/page.tsx.
 */

export interface Plan {
  id: string;
  name: string;
  /** Taka per month, billed monthly. */
  monthly: number;
  tagline: string;
  /** Verifications included each month. */
  quota: number;
  featured: boolean;
  features: readonly string[];
}

/** Yearly is twelve months' use for ten months' money. */
export const MONTHS_CHARGED_YEARLY = 10;

export const PLANS: readonly Plan[] = [
  {
    id: 'starter',
    name: 'Starter',
    monthly: 1000,
    tagline: 'One list a month, cleaned properly.',
    quota: 10_000,
    featured: false,
    features: [
      '10,000 verifications a month',
      'CSV, TSV and XLSX upload',
      'Full API access',
      '60 API requests a minute',
      '7-day result retention',
      'Email support',
    ],
  },
  {
    id: 'growth',
    name: 'Growth',
    monthly: 2000,
    tagline: 'For a list you send to every week.',
    quota: 25_000,
    featured: true,
    features: [
      '25,000 verifications a month',
      'Everything in Starter',
      '120 API requests a minute',
      '14-day result retention',
      'Priority processing queue',
      'Priority email support',
    ],
  },
  {
    id: 'scale',
    name: 'Scale',
    monthly: 5000,
    tagline: 'Agencies and multi-brand senders.',
    quota: 100_000,
    featured: false,
    features: [
      '100,000 verifications a month',
      'Everything in Growth',
      '300 API requests a minute',
      '30-day result retention',
      'Unused credits roll over one month',
      'Direct line for support',
    ],
  },
];

/** Taka per thousand addresses — the number a buyer actually compares on. */
export function unitPrice(plan: Plan): string {
  return (plan.monthly / (plan.quota / 1000)).toFixed(0);
}

export function taka(amount: number): string {
  return `৳${amount.toLocaleString('en-US')}`;
}

/**
 * Resolves a plan id that arrived over the wire.
 *
 * The only way an order route learns a price. A request that could name its
 * own amount could buy the largest plan for one taka, so `planId` is the sole
 * thing taken from the client and everything else is looked up here.
 */
export function findPlan(planId: string): Plan | undefined {
  return PLANS.find((plan) => plan.id === planId);
}

/** The label to show for a plan id on an old order whose plan was withdrawn. */
export function planName(planId: string): string {
  return findPlan(planId)?.name ?? planId;
}
