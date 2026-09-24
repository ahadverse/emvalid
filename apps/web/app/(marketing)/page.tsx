import { SingleCheck } from '@/components/single-check';
import { UploadForm } from '@/components/upload-form';
import { Bolt, Check, Dash, Globe, Layers, Shield } from '@/components/icons';
import { Card, Eyebrow } from '@/components/ui';

export const metadata = {
  title: 'Verify',
};

/**
 * The landing page does two jobs: take a list, and prove the tool is worth
 * trusting on a single address.
 */

/**
 * Presentation switch: hides the layers we do not run from the stack on this
 * page, and adjusts the copy around it to match.
 *
 * Set `true` to put the "Individual mailbox — SMTP — not run" row back.
 *
 * Scope is deliberately narrow — this hides one row on the landing page and
 * nothing else. The single-address report still carries its "Mailbox
 * verification — Not performed" row, the pricing comparison still has a
 * mailbox line reading as a dash across every plan, and the footer still says
 * a passing address is reported as unknown rather than valid. Those are the
 * evidence, and the evidence does not get to change — a buyer who finds the
 * limit in a support ticket after paying is a refund.
 */
const SHOW_UNRUN_LAYERS = false;

const LAYERS = [
  {
    layer: 'Syntax',
    spec: 'RFC 5321 / 5322',
    done: true,
    note: 'Malformed addresses are undeliverable, with certainty.',
  },
  {
    layer: 'Domain and MX',
    spec: 'Live DNS',
    done: true,
    note: 'MX, null MX, A-record fallback, resolver failures kept separate.',
  },
  {
    layer: 'Policy',
    spec: '5 signals',
    done: true,
    note: 'Disposable, role, free provider, typo suggestion, mail platform.',
  },
  {
    layer: 'Individual mailbox',
    spec: 'SMTP',
    done: false,
    note: 'Not checked. No provider allows this to be established reliably from the outside.',
  },
] as const;

const VISIBLE_LAYERS = LAYERS.filter((entry) => SHOW_UNRUN_LAYERS || entry.done);

const CAPABILITIES = [
  {
    icon: Bolt,
    title: 'Built for whole lists',
    body: 'Files stream to disk and are processed in chunks, so memory stays flat whether the list is a thousand rows or ten million.',
  },
  {
    icon: Shield,
    title: 'Nothing is rounded up',
    body: 'Status, confidence, reason code and the sentence behind it travel with every row — into the CSV and out over the API.',
  },
  {
    icon: Globe,
    title: 'Domain intelligence',
    body: 'Disposable providers, role inboxes, misspelled domains and the platform actually running the mail, identified per row.',
  },
] as const;

export default function Home() {
  return (
    <div className="space-y-14">
      {/* -------------------------------------------------- Hero */}
      <section className="relative isolate">
        {/*
          The grid sits behind the header and is masked out before it reaches
          any text. It is decoration; it must never be the reason a word is
          harder to read than it was without it.
        */}
        <div
          aria-hidden
          className="bg-grid pointer-events-none absolute inset-x-0 -top-14 -z-10 h-72 opacity-60"
        />

        <div className="max-w-3xl animate-rise">
          <Eyebrow icon={Layers} tone="accent">
            Three verification layers
          </Eyebrow>

          <h1 className="mt-4 text-[34px] font-semibold leading-[1.1] tracking-[-0.03em] text-ink sm:text-[44px]">
            Know what is in your list
            <span className="block text-ink-muted">before you send to it.</span>
          </h1>

          <p className="mt-5 max-w-2xl text-[15px] leading-relaxed text-ink-muted sm:text-base">
            {/* Tracks SHOW_UNRUN_LAYERS. Promising "an explicit answer about the
                fourth layer" while the stack beside it lists only three is a
                sentence the page can no longer keep. */}
            {SHOW_UNRUN_LAYERS
              ? 'Syntax, domain and policy checks on every address, with an explicit answer about the fourth layer nobody can do. Every row comes back with a status, a confidence score and the reason behind it.'
              : 'Syntax, domain and policy checks on every address. Every row comes back with a status, a confidence score and the reason behind it.'}
          </p>
        </div>
      </section>

      {/* -------------------------------------------------- Upload + stack */}
      <section className="grid gap-6 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <UploadForm />
        </div>

        <div className="lg:col-span-2">
          <VerificationStack />
        </div>
      </section>

      {/* -------------------------------------------------- Single check */}
      <section>
        <SingleCheck />
      </section>

      {/* -------------------------------------------------- Capabilities */}
      <section className="grid gap-4 sm:grid-cols-3">
        {CAPABILITIES.map((item) => {
          const Icon = item.icon;
          return (
            <div
              key={item.title}
              className="rounded-xl border border-line bg-surface p-5 shadow-card"
            >
              <span className="grid h-9 w-9 place-items-center rounded-lg border border-accent-line bg-accent-soft text-accent">
                <Icon className="h-4.5 w-4.5" />
              </span>
              <h3 className="mt-4 text-sm font-semibold tracking-tight text-ink">{item.title}</h3>
              <p className="mt-1.5 text-[13px] leading-relaxed text-ink-muted">{item.body}</p>
            </div>
          );
        })}
      </section>
    </div>
  );
}

/**
 * The layers, drawn as a stack rather than a checklist.
 *
 * The connecting rail is the point of the drawing: it makes the list read as
 * one sequence rather than a scoreboard of features. When SHOW_UNRUN_LAYERS is
 * on, it is also what makes the final unrun entry read as the end of a
 * sequence that stops, rather than as something we forgot.
 */
function VerificationStack() {
  return (
    <Card className="flex h-full flex-col">
      <div className="border-b border-line px-5 py-4">
        <h2 className="text-[15px] font-semibold tracking-tight text-ink">What gets checked</h2>
        <p className="mt-1 text-[13px] leading-relaxed text-ink-muted">
          {SHOW_UNRUN_LAYERS
            ? 'Four layers exist. We run three and say so.'
            : 'Three layers, run on every address in the file.'}
        </p>
      </div>

      <ol className="flex-1 px-5 py-5">
        {VISIBLE_LAYERS.map((entry, index) => {
          const last = index === VISIBLE_LAYERS.length - 1;

          return (
            <li key={entry.layer} className="relative flex gap-3.5 pb-5 last:pb-0">
              {!last && (
                <span
                  aria-hidden
                  className="absolute left-[11px] top-6 h-[calc(100%-1rem)] w-px bg-line"
                />
              )}

              <span
                aria-hidden
                className={[
                  'relative z-10 mt-0.5 grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full border',
                  entry.done
                    ? 'border-good/30 bg-good-soft text-good'
                    : 'border-line bg-surface-sunken text-ink-subtle',
                ].join(' ')}
              >
                {entry.done ? <Check className="h-3 w-3" /> : <Dash className="h-3 w-3" />}
              </span>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <p className="text-sm font-medium text-ink">{entry.layer}</p>
                  <span className="rounded border border-line bg-surface-sunken px-1.5 py-px font-mono text-[10px] uppercase tracking-wide text-ink-subtle">
                    {entry.spec}
                  </span>
                  {!entry.done && (
                    <span className="text-[11px] font-medium uppercase tracking-wide text-ink-subtle">
                      not run
                    </span>
                  )}
                </div>
                <p className="mt-1 text-[13px] leading-relaxed text-ink-muted">{entry.note}</p>
              </div>
            </li>
          );
        })}
      </ol>

      <div className="border-t border-line px-5 py-4">
        <p className="text-[13px] leading-relaxed text-ink-subtle">
          Expect roughly a quarter of a real list to come back with a firm verdict and the rest as
          unknown. Every job summary shows that ratio, so you always know how much of your list was
          actually decided.
        </p>
      </div>
    </Card>
  );
}
