'use client';

import { useState } from 'react';
import { Check, Copy } from './icons';

/**
 * A code sample in more than one language, with the copy button the reader was
 * going to reach for anyway.
 *
 * No syntax highlighter. Every one of them is a client-side parser measured in
 * tens of kilobytes, and these samples are four lines of curl — the colour
 * would cost more than it communicates. What does communicate is that the
 * sample is copyable and correct, which is what the tabs and the button are
 * for.
 */

export interface CodeSample {
  id: string;
  label: string;
  code: string;
}

export function CodeTabs({ samples }: { samples: readonly CodeSample[] }) {
  const [activeId, setActiveId] = useState(samples[0]?.id ?? '');
  const active = samples.find((sample) => sample.id === activeId) ?? samples[0];

  if (active === undefined) return null;

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface-sunken">
      <div className="flex items-center justify-between gap-2 border-b border-line px-2 py-1.5">
        <div role="tablist" aria-label="Language" className="flex min-w-0 gap-0.5 overflow-x-auto">
          {samples.map((sample) => {
            const selected = sample.id === active.id;

            return (
              <button
                key={sample.id}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setActiveId(sample.id)}
                className={[
                  'shrink-0 rounded-md px-2.5 py-1 text-xs font-medium transition-colors duration-150',
                  selected
                    ? 'bg-surface text-ink shadow-card'
                    : 'text-ink-subtle hover:text-ink-muted',
                ].join(' ')}
              >
                {sample.label}
              </button>
            );
          })}
        </div>

        <CopyButton value={active.code} />
      </div>

      <pre className="scroll-x p-4 font-mono text-xs leading-relaxed text-ink">
        <code>{active.code}</code>
      </pre>
    </div>
  );
}

/**
 * Confirmation lives on the button itself and resets on its own. A toast for
 * "copied" is a whole notification system for a fact the user can verify by
 * pressing paste.
 */
export function CopyButton({
  value,
  label = 'Copy',
  className = '',
}: {
  value: string;
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard access can be refused — over plain HTTP, or in a hardened
      // browser profile. The text is on screen and selectable either way, so
      // this is a convenience failing, not the feature failing.
      setCopied(false);
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={copied ? 'Copied' : label}
      className={[
        'inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition-colors duration-150',
        copied ? 'text-good' : 'text-ink-subtle hover:bg-surface hover:text-ink',
        className,
      ].join(' ')}
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? 'Copied' : label}
    </button>
  );
}
